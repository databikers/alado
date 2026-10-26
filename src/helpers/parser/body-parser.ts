import { IncomingMessage, OutgoingMessage } from 'http';
import { ContentType, deprecatedJsonPropertiesRegExp, formDataRegExp, spaceRegExp } from '@const';
import { Readable } from 'stream';
import { AladoServerError } from '@dto';
import { xmlParser } from './xml-parser';

// "application/xml; charset=utf-8" is still XML, and so are +xml types such as SOAP 1.2's application/soap+xml
export function isXmlContentType(contentType: string | undefined): boolean {
  const mime: string = (contentType || '').split(';')[0].trim().toLowerCase();
  return mime === ContentType.XML || mime === ContentType.TEXT_XML || /^application\/[\w.+-]+\+xml$/.test(mime);
}

type ReceivedBody = { chunks: Buffer[]; bytes: number };

function collectChunks(
  req: IncomingMessage,
  limit: number,
  received: ReceivedBody,
  reject: (error: AladoServerError) => void,
) {
  return (chunk: Buffer) => {
    received.bytes += chunk.length;
    if (limit && received.bytes > limit) {
      req.removeAllListeners('data');
      req.removeAllListeners('end');
      reject({
        statusCode: 413,
        message: 'Content Too Large',
      } as AladoServerError);
      return;
    }
    received.chunks.push(chunk);
  };
}

function concatChunks(received: ReceivedBody, encoding: BufferEncoding): string {
  return Buffer.concat(received.chunks, received.bytes).toString(encoding);
}

export async function bodyParser(req: IncomingMessage, res: OutgoingMessage, limit: number) {
  const contentType = req.headers['content-type'];
  const result: any = {
    body: {},
    files: {},
    rawBody: '',
  };
  let body: string = '';
  const received: ReceivedBody = { chunks: [], bytes: 0 };
  if (contentType?.startsWith(ContentType.FORM_DATA)) {
    const matchingArray = /boundary=(.+)$/.exec(req.headers['content-type'] as string);
    const boundary: string | null = matchingArray && matchingArray[1];
    await new Promise<void>((resolve, reject) => {
      req.on('data', collectChunks(req, limit, received, reject));
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
          const element: any = {};
          Object.entries(formDataRegExp).map((entry) => {
            const [
              key,
              regEx,
            ] = entry;
            const regExpMatchArray = item.match(regEx);
            element[key] = regExpMatchArray && regExpMatchArray[1] && regExpMatchArray[1];
          });
          const { value, filename, mimetype } = element;
          // the body is parsed as a binary string (one char per byte) to keep file bytes intact;
          // text (field names and values) is UTF-8 and has to be decoded back
          const name: string | null = element.name && Buffer.from(element.name, 'binary').toString('utf8');
          if (!name || !value) {
            continue;
          }
          if (filename) {
            if (!mimetype) {
              continue;
            }
            const file: any = { name, mimetype };
            file.stream = new Readable();
            file.stream.push(Buffer.from(value, 'binary'));
            file.stream.push(null);
            formData.files.push(file);
          } else {
            formData.fields[name] = Buffer.from(value, 'binary').toString('utf8');
          }
        }
        for (const key in formData.fields) {
          result.body[key] = formData.fields[key];
        }
        formData.files.forEach((file: any) => {
          const { name, stream, mimetype } = file;
          const key = name.replace(spaceRegExp, '');
          result.files[key] = {
            stream: stream,
            size: stream._readableState.length,
            mimetype: mimetype.replace(spaceRegExp, ''),
          };
        });
        resolve();
      });
    });
  } else {
    await new Promise<void>((resolve, reject) => {
      req.on('data', collectChunks(req, limit, received, reject));
      req.on('end', () => {
        body = concatChunks(received, 'utf8');
        result.rawBody = body;
        if (contentType?.startsWith(ContentType.JSON)) {
          try {
            // A reviver takes V8 off its fast JSON path, so only use it when a forbidden key can be present
            result.body = deprecatedJsonPropertiesRegExp.test(body)
              ? JSON.parse(body, function (key, value) {
                  if (!deprecatedJsonPropertiesRegExp.test(key)) {
                    return value;
                  }
                })
              : JSON.parse(body);
            resolve();
          } catch (e) {
            reject({ statusCode: 400, message: `Invalid JSON body` });
          }
        } else if (contentType?.startsWith(ContentType.X_WWW_FORM_URLENCODED)) {
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
