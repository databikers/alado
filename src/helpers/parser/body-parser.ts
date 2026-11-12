import { IncomingMessage, OutgoingMessage } from 'http';
import { constants } from 'buffer';
import { ContentType, deprecatedJsonPropertiesRegExp } from '@const';
import { Readable } from 'stream';
import { AladoServerError, HttpError, UploadedFile } from '@dto';
import { xmlParser } from './xml-parser';
import { JsonDepthError, parseJson } from './json-parser';
import { appendField } from './query-parser';
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

const binaryTypes: Set<string> = new Set([
  ContentType.OCTET_STREAM,
  'application/pdf',
  'application/zip',
  'application/gzip',
  'application/protobuf',
  'application/x-protobuf',
  'application/msgpack',
  'application/cbor',
]);

/**
 * Types whose bytes are not text: decoding them as UTF-8 replaces every invalid sequence, so the
 * content cannot be recovered from the string. Their body is given as bytes (request.rawBodyBytes).
 * Types written as XML or JSON (image/svg+xml) are text.
 */
export function isBinaryContentType(contentType: string | undefined): boolean {
  const mime: string = mediaType(contentType);
  if (mime.endsWith('+xml') || mime.endsWith('+json')) {
    return false;
  }
  return binaryTypes.has(mime) || /^(image|audio|video|font)\//.test(mime);
}

const utf8Charsets: Set<string> = new Set([
  'utf-8',
  'utf8',
  'us-ascii',
]);

// the charset parameter of a Content-Type, lower-cased and unquoted; undefined when there is none
export function charsetOf(contentType: string | undefined): string | undefined {
  const match: RegExpExecArray | null = /;\s*charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType || '');
  return match ? match[1].toLowerCase() : undefined;
}

type PartHeaders = { name: string | null; filename: string | null; mimetype: string | null };
type MultipartFile = { name: string; mimetype: string; filename: string; content: Buffer };

const partNameRegExp: RegExp = /(?:^|[;\s])name="([^"]*)"/i;
const partFilenameRegExp: RegExp = /(?:^|[;\s])filename="([^"]*)"/i;
const partDispositionRegExp: RegExp = /^content-disposition:([^\r\n]*)$/im;
const partContentTypeRegExp: RegExp = /^content-type:([^\r\n]*)$/im;

/**
 * The last segment of a client's file name: "../../etc/passwd" is "passwd" and
 * "C:\\Users\\me\\cv.pdf" (Internet Explorer sent the full path) is "cv.pdf". "." and ".." name a
 * directory, not a file: ''.
 */
function fileBasename(filename: string): string {
  const name: string = filename.slice(Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\')) + 1);
  return name === '.' || name === '..' ? '' : name;
}

const tooManyParts: AladoServerError = { statusCode: 400, message: 'Too many multipart parts' };
const CRLF: Buffer = Buffer.from('\r\n');
const HEADERS_END: Buffer = Buffer.from('\r\n\r\n');

/**
 * Header fields of one part. `headers` is the text before the blank line, read as latin1 (one
 * char per byte); the field name and the file name are UTF-8 and are decoded back. filename="" is
 * kept as '': it is what a browser sends for a file input left empty; directories in a filename
 * are dropped (see fileBasename). name and filename are read
 * from the Content-Disposition field only: `X-Anything: ; name="admin"` or a Content-Type with a
 * name parameter must not rename the part.
 */
export function parsePartHeaders(headers: string): PartHeaders {
  const disposition: string = partDispositionRegExp.exec(headers)?.[1] ?? '';
  const name: RegExpExecArray | null = partNameRegExp.exec(disposition);
  const filename: RegExpExecArray | null = partFilenameRegExp.exec(disposition);
  const mimetype: RegExpExecArray | null = partContentTypeRegExp.exec(headers);
  return {
    name: name && name[1] ? Buffer.from(name[1], 'latin1').toString('utf8') : null,
    filename: filename ? fileBasename(Buffer.from(filename[1], 'latin1').toString('utf8')) : null,
    // the media type alone, lower-cased: "Text/Plain; charset=utf-8" is the type text/plain
    mimetype: mimetype && mediaType(mimetype[1]) ? mediaType(mimetype[1]) : null,
  };
}

/**
 * Splits a multipart body without turning it into a string: delimiters are found with
 * Buffer.indexOf, and a file's content is a subarray() of `raw` (same memory, no copy). Every
 * search is bounded by the part it belongs to, so the whole body is scanned once.
 * A part without its closing delimiter (a cut-off body) is dropped, and `complete` is false: the
 * body has no first delimiter or ends before the close delimiter ("--boundary--").
 * More than `maxParts` parts (every one between two delimiters, named or not; 0: no limit) throws
 * a 400 as soon as the next one is reached, before the rest of the body is scanned.
 */
export function parseMultipartBody(
  raw: Buffer,
  boundary: string,
  maxParts: number = 0,
): {
  fields: Array<
    [
      string,
      Buffer,
    ]
  >;
  files: MultipartFile[];
  complete: boolean;
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
    return { fields, files, complete: false };
  }
  position += dashBoundary.length;
  let complete: boolean = false;
  let parts: number = 0;
  for (;;) {
    // "--" after a delimiter closes the body; anything after it is an epilogue
    if (raw[position] === 45 && raw[position + 1] === 45) {
      complete = true;
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
    if (maxParts && ++parts > maxParts) {
      throw tooManyParts;
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
        } else if (headers.filename !== '' || value.length > 0) {
          // filename="" without content: a file input left empty, no file was chosen. A file sent
          // without a Content-Type is kept as application/octet-stream (RFC 7578 4.4): unknown
          // bytes, which only a field that accepts that type lets through
          files.push({
            name: headers.name,
            mimetype: headers.mimetype || ContentType.OCTET_STREAM,
            filename: headers.filename,
            content: value,
          });
        }
      }
    }
    position = next + delimiter.length;
  }
  return { fields, files, complete };
}

// boundary parameter of a multipart Content-Type, unquoted and without the parameters after it
export function multipartBoundary(contentType: string): string | null {
  const match: RegExpExecArray | null = /;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType || '');
  return match ? match[1] || match[2] : null;
}

type ReceivedBody = { chunks: Buffer[]; bytes: number };

// chunks joined into a Buffer of exactly `size` bytes that nothing else shares (see the multipart branch)
function ownCopy(chunks: Buffer[], size: number): Buffer {
  const copy: Buffer = Buffer.allocUnsafeSlow(size);
  let offset: number = 0;
  for (const chunk of chunks) {
    offset += chunk.copy(copy, offset);
  }
  return copy;
}

const contentTooLarge: AladoServerError = { statusCode: 413, message: 'Content Too Large' };

/**
 * V8 cannot build a string longer than buffer.constants.MAX_STRING_LENGTH (about 512 MB), and
 * decoding more throws. A body decoded as text (JSON, XML, urlencoded, text) above it is refused
 * with 413 while it arrives, even when maxBodySizeBytes is 0 or larger; so is a multipart text field.
 * UTF-8 never decodes to more UTF-16 units than bytes, so a byte count is enough. Exported as an
 * object so tests can lower it.
 */
export const textLimits: { maxBytes: number } = { maxBytes: constants.MAX_STRING_LENGTH };

// an error thrown while a body is turned into request data: never left to crash the process
function toBodyError(e: any): AladoServerError | Error {
  return e?.code === 'ERR_STRING_TOO_LONG' ? contentTooLarge : e;
}

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
  textLimit: number = 0,
) {
  return (chunk: Buffer) => {
    received.bytes += chunk.length;
    if ((limit && received.bytes > limit) || (textLimit && received.bytes > textLimit)) {
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

/** How multipart files are taken (see ParsingOptions). */
export type MultipartFileOptions = {
  repeatedFiles?: 'last' | 'array';
  // files one field name may carry; 0 or unset: no limit
  maxFilesPerField?: number;
  // the declared file fields: files under any other name are skipped before an object is built for
  // them. Unset: every name is kept (allowUnknownFields)
  fieldNames?: ReadonlySet<string>;
  // parts one body may hold, fields and files together; 0 or unset: no limit
  maxParts?: number;
};

const tooManyFiles: AladoServerError = { statusCode: 400, message: 'Too many files under one field name' };
const malformedMultipart: AladoServerError = { statusCode: 400, message: 'Malformed multipart body' };

export async function bodyParser(
  req: IncomingMessage,
  res: OutgoingMessage,
  limit: number,
  acceptFiles: boolean = true,
  fileOptions: MultipartFileOptions = {},
) {
  const { repeatedFiles = 'last', maxFilesPerField = 0, fieldNames, maxParts = 0 } = fileOptions;
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
  // bodies are read as sent: a compressed one would only fail later as "invalid JSON"
  const encoding: string = String(req.headers['content-encoding'] || '')
    .trim()
    .toLowerCase();
  if (encoding && encoding !== 'identity') {
    throw { statusCode: 415, message: 'Unsupported Content-Encoding' } as AladoServerError;
  }
  const binary: boolean = isBinaryContentType(contentType);
  // text is decoded as UTF-8: another declared charset would be read as garbage
  const charset: string | undefined = charsetOf(contentType);
  if (charset && !utf8Charsets.has(charset) && mime !== ContentType.FORM_DATA && !binary) {
    throw { statusCode: 415, message: 'Unsupported charset' } as AladoServerError;
  }
  if (mime === ContentType.FORM_DATA) {
    const boundary: string | null = multipartBoundary(req.headers['content-type'] as string);
    // The body is needed as one Buffer. Joining all chunks at the end holds it twice (chunks plus the
    // joined copy). With a declared Content-Length, the Buffer is allocated at its exact size once half
    // of it has arrived, the chunks so far are copied in and dropped, and the rest is copied as it
    // comes: about 1.5x at the peak. Waiting for half keeps a client from making the server allocate a
    // large body it never sends. Without a declared length (chunked encoding) the chunks are joined.
    // Either way the Buffer is the request's own allocation (allocUnsafeSlow, never Node's shared pool,
    // never a socket chunk that also holds the headers): file contents are views into it, so their
    // `.buffer` must not reach memory outside this body.
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
          try {
            whole = Buffer.allocUnsafeSlow(declared);
          } catch {
            // no memory for a body of the declared size
            abortOversizedBody(req, res);
            reject(contentTooLarge);
            return;
          }
          let offset: number = 0;
          for (const piece of received.chunks) {
            offset += piece.copy(whole, offset);
          }
          received.chunks = [];
        }
      });
      req.once('error', onRequestError(reject));
      const readMultipart = (): void => {
        // one Buffer for the whole body; files are views into it, nothing is copied as a string
        const raw: Buffer = whole ? whole.subarray(0, received.bytes) : ownCopy(received.chunks, received.bytes);
        received.chunks = [];
        // the latin1 ("binary") text of the body costs as much memory again: built only when read
        let rawBody: string | undefined;
        Object.defineProperty(result, 'rawBody', {
          enumerable: true,
          configurable: true,
          get: () => {
            if (rawBody === undefined && raw.length > textLimits.maxBytes) {
              // too long for a string: a 413 for the handler that reads it, not a RangeError
              throw new HttpError(contentTooLarge.statusCode, contentTooLarge.message);
            }
            return (rawBody ??= raw.toString('latin1'));
          },
        });
        // form fields are text: a number()/bigint() field is converted before validation
        result.formBody = true;
        // no body at all is an empty form; a body without a boundary to split it, without its first
        // delimiter or cut off before the close delimiter is refused rather than read in part
        if (!raw.length) {
          resolve();
          return;
        }
        if (!boundary) {
          reject(malformedMultipart);
          return;
        }
        const { fields, files, complete } = parseMultipartBody(raw, boundary, maxParts);
        if (!complete) {
          reject(malformedMultipart);
          return;
        }
        for (const [
          name,
          value,
        ] of fields) {
          // same keys the JSON and urlencoded parsers drop (__proto__, constructor, ...)
          if (!deprecatedJsonPropertiesRegExp.test(name)) {
            if (value.length > textLimits.maxBytes) {
              reject(contentTooLarge);
              return;
            }
            // a repeated name or name[] gives an array, as in a query string or a urlencoded form
            appendField(result.body, name, value.toString('utf8'));
          }
        }
        if (acceptFiles) {
          const counts: Map<string, number> = new Map();
          for (const file of files) {
            let key: string = file.name.trim();
            // name[] asks for a list (with repeatedFiles: 'array'), like a query or form field
            const listed: boolean = repeatedFiles === 'array' && key.length > 2 && key.endsWith('[]');
            if (listed) {
              key = key.slice(0, -2);
            }
            // a file named __proto__ would otherwise replace the prototype of request.files; a field
            // the route does not declare is dropped by validation anyway: skip it before building it
            if (deprecatedJsonPropertiesRegExp.test(key) || (fieldNames && !fieldNames.has(key))) {
              continue;
            }
            // counted before anything is built, so thousands of parts under one name cost nothing
            const count: number = (counts.get(key) || 0) + 1;
            if (maxFilesPerField && count > maxFilesPerField) {
              reject(tooManyFiles);
              return;
            }
            counts.set(key, count);
            const stream: Readable = new Readable();
            stream.push(file.content);
            stream.push(null);
            const uploaded: UploadedFile = {
              stream,
              // byte length of the content, not a private field of the stream
              size: file.content.length,
              mimetype: file.mimetype,
              filename: file.filename,
            };
            uploadedFileHeads.set(uploaded, file.content.subarray(0, FILE_SIGNATURE_BYTES));
            const previous: UploadedFile | UploadedFile[] | undefined = result.files[key];
            if (repeatedFiles === 'last') {
              result.files[key] = uploaded;
            } else if (Array.isArray(previous)) {
              previous.push(uploaded);
            } else if (previous) {
              result.files[key] = [
                previous,
                uploaded,
              ];
            } else {
              result.files[key] = listed
                ? [
                    uploaded,
                  ]
                : uploaded;
            }
          }
        }
        resolve();
      };
      req.on('end', () => {
        try {
          readMultipart();
        } catch (e) {
          reject(toBodyError(e));
        }
      });
    });
  } else {
    await new Promise<void>((resolve, reject) => {
      req.on('data', collectChunks(req, res, limit, received, reject, textLimits.maxBytes));
      req.once('error', onRequestError(reject));
      const readText = (): void => {
        if (binary) {
          // the exact bytes, in a Buffer of their own (never Node's pool or a socket chunk)
          result.rawBodyBytes = ownCopy(received.chunks, received.bytes);
          resolve();
          return;
        }
        body = concatChunks(received, 'utf8');
        result.rawBody = body;
        // a UTF-8 byte order mark (written by some Windows tools) is not part of the document:
        // parsers refuse it, so it is skipped for parsing; rawBody keeps the body as sent
        if (body.charCodeAt(0) === 0xfeff) {
          body = body.slice(1);
        }
        if (!body && !mime) {
          // nothing sent and no type given: there is no body (request.body stays missing). An empty
          // text/plain body is the text '', an empty JSON, XML or form body an empty object
          result.body = undefined;
          resolve();
        } else if (isJsonContentType(contentType) && !body) {
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
          // URLSearchParams decodes %XX and '+', keeps '=' inside values and never throws. A repeated
          // key or key[] gives an array (checkboxes, multi-selects), as in a query string
          for (const [
            key,
            value,
          ] of new URLSearchParams(body)) {
            if (key && !deprecatedJsonPropertiesRegExp.test(key)) {
              appendField(result.body, key, value);
            }
          }
          result.formBody = true;
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
      };
      req.on('end', () => {
        try {
          readText();
        } catch (e) {
          reject(toBodyError(e));
        }
      });
    });
  }
  return result;
}
