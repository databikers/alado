import { IncomingMessage, OutgoingMessage } from 'http';
import { ContentType, deprecatedJsonPropertiesRegExp, formDataRegExp, spaceRegExp } from '@const';
import { Readable } from 'stream';
import { AladoServerError } from '@dto';

export async function bodyParser(req: IncomingMessage, res: OutgoingMessage, limit: number) {
  const contentType = req.headers['content-type'];
  const result: any = {
    body: {},
    files: {},
    rawBody: '',
  };
  let body: string = '';
  if (contentType?.startsWith(ContentType.FORM_DATA)) {
    req.setEncoding('binary');
    const matchingArray = /boundary=(.+)$/.exec(req.headers['content-type']);
    const boundary: string = matchingArray && matchingArray[1];
    await new Promise<void>((resolve, reject) => {
      req.on('data', (chunk: any) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        result.rawBody = body;
        const formData: any = {
          files: [],
          fields: {},
        };
        const data = body.split(boundary);
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
          const { name, value, filename, mimetype } = element;
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
            formData.fields[name] = value;
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
      req.on('data', (chunk: any) => {
        body += chunk.toString();
        if (limit && Buffer.byteLength(body, 'utf8') > limit) {
          req.removeAllListeners('data');
          req.removeAllListeners('end');
          reject({
            statusCode: 413,
            message: 'Content Too Large'
          } as AladoServerError)
        }
      });
      req.on('end', () => {
        result.rawBody = body;
        if (contentType?.startsWith(ContentType.JSON)) {
          try {
            result.body = JSON.parse(body, function (key, value) {
              if (!deprecatedJsonPropertiesRegExp.test(key)) {
                return value;
              }
            });
            resolve();
          } catch (e) {
            reject({ statusCode: 400, message: `Invalid JSON body` });
          }
        } else if (contentType?.startsWith(ContentType.X_WWW_FORM_URLENCODED)) {
          body.split('&').forEach((item: string) => {
            const [
              key,
              value,
            ] = item.split('=');
            result.body[key] = value;
          });
          resolve();
        } else {
          result.body = body;
          resolve();
        }
      });
    });
  }
  return result;
}
