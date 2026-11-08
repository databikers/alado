import { IncomingMessage, OutgoingMessage } from 'http';
import { ContentType, deprecatedJsonPropertiesRegExp, spaceRegExp } from '@const';
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

type MultipartPart = { name: string | null; value: string | null; filename: string | null; mimetype: string | null };

const partNameRegExp: RegExp = /(?:^|[;\s])name="([^"]*)"/i;
const partFilenameRegExp: RegExp = /(?:^|[;\s])filename="([^"]*)"/i;
const partContentTypeRegExp: RegExp = /^content-type:([^\r\n]*)$/im;

/**
 * Splits one multipart part (the text between two boundaries) into its headers and value,
 * in linear time: headers end at the first blank line, and the value runs up to the
 * "\r\n--" that precedes the next boundary. Header fields are read from the headers only.
 */
export function parseMultipartPart(item: string): MultipartPart | null {
  const headerEnd: number = item.indexOf('\r\n\r\n');
  if (headerEnd === -1) {
    return null;
  }
  const valueStart: number = headerEnd + 4;
  const valueEnd: number = item.length - 4;
  const value: string | null =
    valueEnd >= valueStart && item.endsWith('\r\n--') ? item.slice(valueStart, valueEnd) : null;
  const headers: string = item.slice(0, headerEnd);
  const pick = (regExp: RegExp): string | null => {
    const match: RegExpExecArray | null = regExp.exec(headers);
    return match && match[1] ? match[1] : null;
  };
  // filename="" is kept as '': it is what a browser sends for a file input left empty
  const filenameMatch: RegExpExecArray | null = partFilenameRegExp.exec(headers);
  return {
    name: pick(partNameRegExp),
    // '' is a field or file sent empty, null a part without a well-formed value
    value,
    filename: filenameMatch ? filenameMatch[1] : null,
    mimetype: pick(partContentTypeRegExp),
  };
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
    await new Promise<void>((resolve, reject) => {
      req.on('data', collectChunks(req, res, limit, received, reject));
      req.once('error', onRequestError(reject));
      req.on('end', () => {
        // multipart is parsed as a binary string: one char per byte, file bytes kept intact
        body = concatChunks(received, 'binary');
        result.rawBody = body;
        const formData: any = {
          files: [],
          fields: {},
        };
        const data = boundary ? body.split(boundary) : [body];
        for (const item of data) {
          const element = parseMultipartPart(item);
          if (!element) {
            continue;
          }
          const { value, filename, mimetype } = element;
          // the body is parsed as a binary string (one char per byte) to keep file bytes intact;
          // text (field names and values) is UTF-8 and has to be decoded back
          const name: string | null = element.name && Buffer.from(element.name, 'binary').toString('utf8');
          if (!name || value === null) {
            continue;
          }
          if (filename !== null) {
            // a file input left empty: no file was chosen
            if (filename === '' && value === '') {
              continue;
            }
            if (!mimetype || !acceptFiles) {
              continue;
            }
            const file: any = { name, mimetype };
            file.head = Buffer.from(value.slice(0, FILE_SIGNATURE_BYTES), 'binary');
            const content: Buffer = Buffer.from(value, 'binary');
            file.size = content.length;
            file.stream = new Readable();
            file.stream.push(content);
            file.stream.push(null);
            formData.files.push(file);
          } else if (!deprecatedJsonPropertiesRegExp.test(name)) {
            // same keys the JSON and urlencoded parsers drop (__proto__, constructor, ...)
            formData.fields[name] = Buffer.from(value, 'binary').toString('utf8');
          }
        }
        for (const key in formData.fields) {
          result.body[key] = formData.fields[key];
        }
        formData.files.forEach((file: any) => {
          const { name, stream, mimetype, size } = file;
          const key = name.replace(spaceRegExp, '');
          // a file named __proto__ would otherwise replace the prototype of request.files
          if (deprecatedJsonPropertiesRegExp.test(key)) {
            return;
          }
          result.files[key] = {
            stream: stream,
            // byte length of the content, not a private field of the stream
            size,
            mimetype: mimetype.replace(spaceRegExp, ''),
          };
          uploadedFileHeads.set(result.files[key], file.head);
        });
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
