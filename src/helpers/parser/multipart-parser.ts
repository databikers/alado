import { IncomingMessage, OutgoingMessage } from 'http';
import { createReadStream, createWriteStream, unlink, ReadStream, WriteStream } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { Readable } from 'stream';
import { deprecatedJsonPropertiesRegExp } from '@const';
import { AladoServerError } from '@dto';
import { FILE_SIGNATURE_BYTES, uploadedFileHeads } from '../validate/context/file-signature';

export type UploadOptions = {
  // a file larger than this goes to a temporary file instead of memory
  memoryThresholdBytes: number;
  // where those temporary files are written
  directory: string;
};

export type PartHeaders = { name: string | null; filename: string | null; mimetype: string | null };

const partNameRegExp: RegExp = /(?:^|[;\s])name="([^"]*)"/i;
const partFilenameRegExp: RegExp = /(?:^|[;\s])filename="([^"]*)"/i;
const partContentTypeRegExp: RegExp = /^content-type:([^\r\n]*)$/im;

// headers of one part above this size are refused: they are a few hundred bytes in practice
const MAX_PART_HEADERS_BYTES: number = 16 * 1024;
const CRLF: Buffer = Buffer.from('\r\n');
const HEADERS_END: Buffer = Buffer.from('\r\n\r\n');
const badRequest: AladoServerError = { statusCode: 400, message: 'Bad Request' };
const malformed: AladoServerError = { statusCode: 400, message: 'Malformed multipart body' };

/**
 * Header fields of one part. `headers` is the text before the blank line, read as latin1 (one
 * char per byte); the field name is UTF-8 and is decoded back. filename="" is kept as '': it is
 * what a browser sends for a file input left empty.
 */
export function parsePartHeaders(headers: string): PartHeaders {
  const name: RegExpExecArray | null = partNameRegExp.exec(headers);
  const filename: RegExpExecArray | null = partFilenameRegExp.exec(headers);
  const mimetype: RegExpExecArray | null = partContentTypeRegExp.exec(headers);
  return {
    name: name && name[1] ? Buffer.from(name[1], 'latin1').toString('utf8') : null,
    filename: filename ? filename[1] : null,
    mimetype: mimetype && mimetype[1].trim() ? mimetype[1].trim() : null,
  };
}

// a temporary file that is gone as soon as nothing needs it: errors are ignored (already removed)
function removeFile(path: string): void {
  unlink(path, () => undefined);
}

type FieldPart = { kind: 'field'; name: string; chunks: Buffer[] };
type FilePart = {
  kind: 'file';
  name: string;
  filename: string;
  mimetype: string;
  size: number;
  head: Buffer;
  chunks: Buffer[];
  path?: string;
  writer?: WriteStream;
};
type Part = FieldPart | FilePart | { kind: 'skip' };

type ParsedFile = { name: string; mimetype: string; size: number; head: Buffer; chunks: Buffer[]; path?: string };

/**
 * Streaming multipart/form-data parser. Parts are cut out of the chunks as they arrive, so the
 * body is never joined or copied as a whole: fields and small files are kept as the received
 * chunks, a file past `memoryThresholdBytes` is written to a temporary file while it arrives
 * (with backpressure on the request). Temporary files are removed once their stream is closed,
 * and streams nobody started reading are closed with the response.
 */
export function parseMultipart(
  req: IncomingMessage,
  res: OutgoingMessage,
  boundary: string,
  limit: number,
  acceptFiles: boolean,
  uploads: UploadOptions,
): Promise<{ body: Record<string, string>; files: Record<string, any> }> {
  const delimiter: Buffer = Buffer.from(`\r\n--${boundary}`);
  const fields: Record<string, string> = {};
  const files: ParsedFile[] = [];
  const writers: Promise<void>[] = [];
  const temporaryFiles: Set<string> = new Set();
  // the body starts with "--boundary", without the CRLF the other delimiters have
  let pending: Buffer = CRLF;
  let state: 'preamble' | 'afterDelimiter' | 'headers' | 'body' | 'end' = 'preamble';
  let headersSearchFrom: number = 0;
  let part: Part = { kind: 'skip' };
  let received: number = 0;
  let failed: boolean = false;

  const cleanUp = (): void => {
    for (const path of temporaryFiles) {
      removeFile(path);
    }
    temporaryFiles.clear();
  };

  const startPart = (headers: PartHeaders): Part => {
    const { name, filename, mimetype } = headers;
    if (!name) {
      return { kind: 'skip' };
    }
    if (filename === null) {
      return { kind: 'field', name, chunks: [] };
    }
    if (!mimetype || !acceptFiles) {
      return { kind: 'skip' };
    }
    return { kind: 'file', name, filename, mimetype, size: 0, head: Buffer.alloc(0), chunks: [] };
  };

  const write = (data: Buffer): void => {
    if (!data.length || part.kind === 'skip') {
      return;
    }
    if (part.kind === 'field') {
      part.chunks.push(data);
      return;
    }
    const file: FilePart = part;
    if (file.head.length < FILE_SIGNATURE_BYTES) {
      file.head = Buffer.concat([
        file.head,
        data.subarray(0, FILE_SIGNATURE_BYTES - file.head.length),
      ]);
    }
    file.size += data.length;
    if (!file.writer && file.size > uploads.memoryThresholdBytes) {
      file.path = join(uploads.directory, `alado-upload-${randomBytes(12).toString('hex')}`);
      temporaryFiles.add(file.path);
      file.writer = createWriteStream(file.path, { flags: 'wx', mode: 0o600 });
      const writer: WriteStream = file.writer;
      writers.push(
        new Promise<void>((resolve, reject) => {
          // 'close' follows 'finish', and also a destroy() of a part that was dropped
          writer.once('error', reject);
          writer.once('close', resolve);
          // a writer ended while the request is paused for it emits 'finish' and no 'drain'
          writer.once('close', () => req.resume());
        }),
      );
      for (const chunk of file.chunks) {
        writer.write(chunk);
      }
      file.chunks = [];
    }
    if (file.writer) {
      // backpressure: stop reading the request until the disk has caught up
      if (!file.writer.write(data)) {
        req.pause();
        file.writer.once('drain', () => req.resume());
      }
    } else {
      file.chunks.push(data);
    }
  };

  const endPart = (): void => {
    if (part.kind === 'field') {
      // same keys the JSON and urlencoded parsers drop (__proto__, constructor, ...)
      if (!deprecatedJsonPropertiesRegExp.test(part.name)) {
        fields[part.name] = Buffer.concat(part.chunks).toString('utf8');
      }
    } else if (part.kind === 'file') {
      part.writer?.end();
      // a file input left empty (no file chosen) is sent as filename="" without content
      if (part.filename !== '' || part.size > 0) {
        files.push(part);
      }
    }
    part = { kind: 'skip' };
  };

  // a part cut off by the end of the body is dropped, as is anything it wrote to disk
  const dropPart = (): void => {
    if (part.kind === 'file' && part.writer) {
      part.writer.destroy();
    }
    part = { kind: 'skip' };
  };

  // returns false when the body is malformed
  const consume = (): boolean => {
    for (;;) {
      switch (state) {
        case 'preamble': {
          const index: number = pending.indexOf(delimiter);
          if (index === -1) {
            pending = pending.subarray(Math.max(0, pending.length - delimiter.length + 1));
            return true;
          }
          pending = pending.subarray(index + delimiter.length);
          state = 'afterDelimiter';
          break;
        }
        case 'afterDelimiter': {
          if (pending.length < 2) {
            return true;
          }
          if (pending[0] === 45 && pending[1] === 45) {
            // "--": the closing delimiter, anything after it is an epilogue
            state = 'end';
            pending = Buffer.alloc(0);
            return true;
          }
          // optional whitespace ("transport padding") before the line break
          const lineEnd: number = pending.indexOf(CRLF);
          if (lineEnd === -1) {
            return pending.length <= 1024;
          }
          if (pending.subarray(0, lineEnd).some((byte: number) => byte !== 32 && byte !== 9)) {
            return false;
          }
          pending = pending.subarray(lineEnd + 2);
          state = 'headers';
          headersSearchFrom = 0;
          break;
        }
        case 'headers': {
          let headersEnd: number;
          let bodyStart: number;
          if (pending.length >= 2 && pending[0] === 13 && pending[1] === 10) {
            // a part without any header line
            headersEnd = 0;
            bodyStart = 2;
          } else {
            headersEnd = pending.indexOf(HEADERS_END, headersSearchFrom);
            bodyStart = headersEnd + 4;
          }
          if (headersEnd === -1) {
            if (pending.length > MAX_PART_HEADERS_BYTES) {
              return false;
            }
            headersSearchFrom = Math.max(0, pending.length - 3);
            return true;
          }
          part = startPart(parsePartHeaders(pending.subarray(0, headersEnd).toString('latin1')));
          pending = pending.subarray(bodyStart);
          state = 'body';
          break;
        }
        case 'body': {
          const index: number = pending.indexOf(delimiter);
          if (index === -1) {
            // the end of this chunk may be the start of a delimiter: keep it for the next one
            const safe: number = pending.length - delimiter.length + 1;
            if (safe > 0) {
              write(pending.subarray(0, safe));
              pending = pending.subarray(safe);
            }
            return true;
          }
          write(pending.subarray(0, index));
          endPart();
          pending = pending.subarray(index + delimiter.length);
          state = 'afterDelimiter';
          break;
        }
        case 'end':
          return true;
      }
    }
  };

  return new Promise((resolve, reject) => {
    const fail = (error: AladoServerError | Error, close: boolean = false): void => {
      if (failed) {
        return;
      }
      failed = true;
      req.removeAllListeners('data');
      req.removeAllListeners('end');
      req.resume();
      if (close && !res.headersSent) {
        res.setHeader('Connection', 'close');
      }
      dropPart();
      for (const file of files) {
        (file as FilePart).writer?.destroy();
      }
      cleanUp();
      reject(error);
    };

    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (limit && received > limit) {
        // the rest is not read: the connection is closed once the 413 response is sent
        fail({ statusCode: 413, message: 'Content Too Large' }, true);
        return;
      }
      if (state === 'end') {
        return;
      }
      pending = pending.length
        ? Buffer.concat([
            pending,
            chunk,
          ])
        : chunk;
      if (!consume()) {
        fail(malformed, true);
      }
    });
    req.once('error', () => fail(badRequest));
    req.on('end', () => {
      if (failed) {
        return;
      }
      if (state !== 'end') {
        dropPart();
      }
      Promise.all(writers).then(
        () => {
          resolve({ body: fields, files: toRequestFiles(files, res, temporaryFiles) });
        },
        (error: Error) => fail(error),
      );
    });
  });
}

/**
 * request.files: the last file of a name wins, as for fields. A file kept in memory is a stream
 * over its chunks; a file on disk is a stream over the temporary file, which is removed as soon as
 * the file is open (POSIX keeps it readable) or, on Windows, once the stream is closed.
 */
function toRequestFiles(parsed: ParsedFile[], res: OutgoingMessage, temporaryFiles: Set<string>): Record<string, any> {
  const result: Record<string, any> = {};
  const fromDisk: ReadStream[] = [];
  for (const file of parsed) {
    const key: string = file.name.trim();
    // a file named __proto__ would otherwise replace the prototype of request.files
    if (deprecatedJsonPropertiesRegExp.test(key)) {
      if (file.path) {
        removeFile(file.path);
        temporaryFiles.delete(file.path);
      }
      continue;
    }
    let stream: Readable;
    if (file.path) {
      const path: string = file.path;
      temporaryFiles.delete(path);
      const fileStream: ReadStream = createReadStream(path);
      if (process.platform !== 'win32') {
        fileStream.once('open', () => removeFile(path));
      }
      fileStream.once('close', () => removeFile(path));
      fromDisk.push(fileStream);
      stream = fileStream;
    } else {
      stream = Readable.from(file.chunks, { objectMode: false });
    }
    const previous = result[key];
    if (previous && typeof previous.stream?.destroy === 'function') {
      previous.stream.destroy();
    }
    result[key] = { stream, size: file.size, mimetype: file.mimetype };
    uploadedFileHeads.set(result[key], file.head);
  }
  // a stream the handler never started reading would keep its file open: close it with the response
  if (fromDisk.length) {
    res.once('close', () => {
      for (const stream of fromDisk) {
        if (stream.readableFlowing === null && !stream.readableDidRead) {
          stream.destroy();
        }
      }
    });
  }
  // files that never got as far as a stream (dropped duplicates are removed above)
  for (const path of temporaryFiles) {
    removeFile(path);
  }
  temporaryFiles.clear();
  return result;
}
