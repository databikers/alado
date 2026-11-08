import { IncomingMessage, OutgoingMessage } from 'http';
import { ContentType, deprecatedJsonPropertiesRegExp } from '@const';
import { Readable } from 'stream';
import { AladoServerError } from '@dto';
import { xmlParser } from './xml-parser';
import { JsonDepthError, parseJson } from './json-parser';
import { FILE_SIGNATURE_BYTES, uploadedFileHeads } from '../validate/context/file-signature';

// "application/xml; charset=utf-8" is still XML, and so are +xml types such as SOAP 1.2's application/soap+xml
// media type without parameters, lower-cased: "Application/JSON; charset=utf-8" -> "application/json"
export function mediaType(contentType: string | undefined): string {
  return (contentType || '').split(';')[0].trim().toLowerCase();
}

export function isXmlContentType(contentType: string | undefined): boolean {
  const mime: string = mediaType(contentType);
  return mime === ContentType.XML || mime === ContentType.TEXT_XML || /^application\/[\w.+-]+\+xml$/.test(mime);
}

// application/json, and +json types such as application/merge-patch+json or application/problem+json
export function isJsonContentType(contentType: string | undefined): boolean {
  const mime: string = mediaType(contentType);
  return mime === ContentType.JSON || /^application\/[\w.+-]+\+json$/.test(mime);
}

type PartHeaders = { name: string | null; filename: string | null; mimetype: string | null };
type MultipartFile = { name: string; mimetype: string; content: Buffer };

const partNameRegExp: RegExp = /(?:^|[;\s])name="([^"]*)"/i;
const partFilenameRegExp: RegExp = /(?:^|[;\s])filename="([^"]*)"/i;
const partContentTypeRegExp: RegExp = /^content-type:([^\r\n]*)$/im;
const CRLF: Buffer = Buffer.from('\r\n');
const HEADERS_END: Buffer = Buffer.from('\r\n\r\n');

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

/**
 * Splits a multipart body without turning it into a string: delimiters are found with
 * Buffer.indexOf, and a file's content is a subarray() of `raw` (same memory, no copy). Every
 * search is bounded by the part it belongs to, so the whole body is scanned once.
 * A part without its closing delimiter (a cut-off body) is dropped.
 */
export function parseMultipartBody(
  raw: Buffer,
  boundary: string,
): {
  fields: Array<
    [
      string,
      Buffer,
    ]
  >;
  files: MultipartFile[];
} {
  const fields: Array<
    [
      string,
      Buffer,
    ]
  > = [];
  const files: MultipartFile[] = [];
  const dashBoundary: Buffer = Buffer.from(`--${boundary}`);
  // every delimiter but the first is preceded by a line break, which belongs to it
  const delimiter: Buffer = Buffer.from(`\r\n--${boundary}`);
  let position: number = raw.indexOf(dashBoundary);
  if (position === -1) {
    return { fields, files };
  }
  position += dashBoundary.length;
  for (;;) {
    // "--" after a delimiter closes the body; anything after it is an epilogue
    if (raw[position] === 45 && raw[position + 1] === 45) {
      break;
    }
    // the rest of the delimiter line (optional whitespace) up to its line break
    const lineEnd: number = raw.indexOf(CRLF, position);
    if (lineEnd === -1) {
      break;
    }
    const headersStart: number = lineEnd + 2;
    const next: number = raw.indexOf(delimiter, headersStart);
    if (next === -1) {
      break;
    }
    // the blank line ending the headers, looked for inside this part only
    const part: Buffer = raw.subarray(headersStart, next);
    let headersEnd: number;
    let valueStart: number;
    if (part[0] === 13 && part[1] === 10) {
      // a part without any header line
      headersEnd = 0;
      valueStart = 2;
    } else {
      headersEnd = part.indexOf(HEADERS_END);
      valueStart = headersEnd + 4;
    }
    if (headersEnd !== -1) {
      const headers: PartHeaders = parsePartHeaders(part.toString('latin1', 0, headersEnd));
      const value: Buffer = part.subarray(valueStart);
      if (headers.name) {
        if (headers.filename === null) {
          fields.push([
            headers.name,
            value,
          ]);
        } else if (headers.mimetype && (headers.filename !== '' || value.length > 0)) {
          // filename="" without content: a file input left empty, no file was chosen
          files.push({ name: headers.name, mimetype: headers.mimetype, content: value });
        }
      }
    }
    position = next + delimiter.length;
  }
  return { fields, files };
}

// boundary parameter of a multipart Content-Type, unquoted and without the parameters after it
export function multipartBoundary(contentType: string): string | null {
  const match: RegExpExecArray | null = /;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType || '');
  return match ? match[1] || match[2] : null;
}

type ReceivedBody = { chunks: Buffer[]; bytes: number };

const contentTooLarge: AladoServerError = { statusCode: 413, message: 'Content Too Large' };

/**
 * Stops buffering an oversized body. The rest of it is not read: the connection is
 * closed once the 413 response is sent, so the client cannot keep streaming into it.
 */
function abortOversizedBody(req: IncomingMessage, res: OutgoingMessage) {
  req.removeAllListeners('data');
  req.removeAllListeners('end');
  if (!res.headersSent) {
    res.setHeader('Connection', 'close');
  }
}

function collectChunks(
  req: IncomingMessage,
  res: OutgoingMessage,
  limit: number,
  received: ReceivedBody,
  reject: (error: AladoServerError) => void,
) {
  return (chunk: Buffer) => {
    received.bytes += chunk.length;
    if (limit && received.bytes > limit) {
      abortOversizedBody(req, res);
      reject(contentTooLarge);
      return;
    }
    received.chunks.push(chunk);
  };
}

// a broken or aborted upload ends the request instead of leaving it pending
function onRequestError(reject: (error: AladoServerError) => void) {
  return () => reject({ statusCode: 400, message: 'Bad Request' });
}

function concatChunks(received: ReceivedBody, encoding: BufferEncoding): string {
  // small bodies usually arrive in one chunk: decode it without copying
  if (received.chunks.length === 1) {
    return received.chunks[0].toString(encoding);
  }
  return Buffer.concat(received.chunks, received.bytes).toString(encoding);
}

export async function bodyParser(
  req: IncomingMessage,
  res: OutgoingMessage,
  limit: number,
  acceptFiles: boolean = true,
) {
  const contentType = req.headers['content-type'];
  const result: any = {
    body: {},
    files: {},
    rawBody: '',
  };
  let body: string = '';
  const received: ReceivedBody = { chunks: [], bytes: 0 };
  // a declared length above the limit is refused before anything is read
  const declaredLength: number = Number(req.headers['content-length']);
  if (limit && declaredLength > limit) {
    abortOversizedBody(req, res);
    throw contentTooLarge;
  }
  const mime: string = mediaType(contentType);
  if (mime === ContentType.FORM_DATA) {
    const boundary: string | null = multipartBoundary(req.headers['content-type'] as string);
    // The body is needed as one Buffer. Joining all chunks at the end holds it twice (chunks plus the
    // joined copy). With a declared Content-Length, the Buffer is allocated at its exact size once half
    // of it has arrived, the chunks so far are copied in and dropped, and the rest is copied as it
    // comes: about 1.5x at the peak. Waiting for half keeps a client from making the server allocate a
    // large body it never sends. Without a declared length (chunked encoding) the chunks are joined.
    const declared: number = Number.isSafeInteger(declaredLength) && declaredLength > 0 ? declaredLength : 0;
    let whole: Buffer | undefined;
    await new Promise<void>((resolve, reject) => {
      const collect = collectChunks(req, res, limit, received, reject);
      req.on('data', (chunk: Buffer) => {
        if (whole) {
          if (received.bytes + chunk.length > whole.length) {
            // more than Content-Length: Node's HTTP parser does not let it through, refuse it anyway
            req.removeAllListeners('data');
            req.removeAllListeners('end');
            reject({ statusCode: 400, message: 'Bad Request' });
            return;
          }
          chunk.copy(whole, received.bytes);
          received.bytes += chunk.length;
          return;
        }
        collect(chunk);
        if (declared && received.bytes * 2 >= declared && received.bytes <= declared) {
          whole = Buffer.allocUnsafe(declared);
          let offset: number = 0;
          for (const piece of received.chunks) {
            offset += piece.copy(whole, offset);
          }
          received.chunks = [];
        }
      });
      req.once('error', onRequestError(reject));
      req.on('end', () => {
        // one Buffer for the whole body; files are views into it, nothing is copied as a string
        const raw: Buffer = whole
          ? whole.subarray(0, received.bytes)
          : received.chunks.length === 1
            ? received.chunks[0]
            : Buffer.concat(received.chunks, received.bytes);
        received.chunks = [];
        // the latin1 ("binary") text of the body costs as much memory again: built only when read
        let rawBody: string | undefined;
        Object.defineProperty(result, 'rawBody', {
          enumerable: true,
          configurable: true,
          get: () => (rawBody ??= raw.toString('latin1')),
        });
        if (!boundary) {
          resolve();
          return;
        }
        const { fields, files } = parseMultipartBody(raw, boundary);
        for (const [
          name,
          value,
        ] of fields) {
          // same keys the JSON and urlencoded parsers drop (__proto__, constructor, ...)
          if (!deprecatedJsonPropertiesRegExp.test(name)) {
            result.body[name] = value.toString('utf8');
          }
        }
        if (acceptFiles) {
          for (const file of files) {
            const key: string = file.name.trim();
            // a file named __proto__ would otherwise replace the prototype of request.files
            if (deprecatedJsonPropertiesRegExp.test(key)) {
              continue;
            }
            const stream: Readable = new Readable();
            stream.push(file.content);
            stream.push(null);
            result.files[key] = {
              stream,
              // byte length of the content, not a private field of the stream
              size: file.content.length,
              mimetype: file.mimetype,
            };
            uploadedFileHeads.set(result.files[key], file.content.subarray(0, FILE_SIGNATURE_BYTES));
          }
        }
        resolve();
      });
    });
  } else {
    await new Promise<void>((resolve, reject) => {
      req.on('data', collectChunks(req, res, limit, received, reject));
      req.once('error', onRequestError(reject));
      req.on('end', () => {
        body = concatChunks(received, 'utf8');
        result.rawBody = body;
        if (isJsonContentType(contentType) && !body) {
          // no body at all (clients often send the header on every request): same as the other types
          resolve();
        } else if (isJsonContentType(contentType)) {
          try {
            result.body = parseJson(body) as Record<string, any>;
            resolve();
          } catch (e) {
            // the depth message is ours; a SyntaxError's text is not passed on
            reject({
              statusCode: 400,
              message: e instanceof JsonDepthError ? `Invalid JSON body: ${e.message}` : `Invalid JSON body`,
            });
          }
        } else if (mime === ContentType.X_WWW_FORM_URLENCODED) {
          // URLSearchParams decodes %XX and '+', keeps '=' inside values and never throws
          for (const [
            key,
            value,
          ] of new URLSearchParams(body)) {
            if (key && !deprecatedJsonPropertiesRegExp.test(key)) {
              result.body[key] = value;
            }
          }
          resolve();
        } else if (isXmlContentType(contentType)) {
          try {
            result.body = xmlParser(body);
            resolve();
          } catch (e) {
            reject({ statusCode: 400, message: `Invalid XML body: ${e.message}` });
          }
        } else {
          result.body = body;
          resolve();
        }
      });
    });
  }
  return result;
}
