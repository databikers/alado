import { IncomingMessage } from 'http';
import { ContentType } from '@const';
const parseFormData = require('parse-formdata');

export
async function bodyParser(req: IncomingMessage) {
  const contentType = req.headers['content-type'];
  const result: any = {
    body: {},
    files: {}
  }
  let body: string = '';
  if (contentType.match(ContentType.FORM_DATA)) {
    req.setEncoding('latin1');

    const { fields, parts } = await new Promise<{ fields: any, parts: any[]}>((resolve, reject) => {
      parseFormData(req, (err: Error, state: { fields: any, parts: any[]}) => {
        if (err) {
          reject(err)
        } else {
          return resolve(state);
        }
      })

    });
    for (const key in fields) {
      result.body[key] = fields[key];
    }
    parts.forEach((part: any) => {
      const { name, stream, mimetype } = part;
      result.files[name] = {
        stream: stream,
        size: stream._readableState.length,
        mimetype
      }
    })

  } else {
    await new Promise<void>((resolve, reject) => {
      req.on('data', (chunk: any) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        if (contentType === ContentType.JSON) {
          try {
            result.body = JSON.parse(body);
            resolve();
          } catch(e) {
            reject({ statusCode: 400, message: `Invalid JSON`})
          }
        } else if (contentType === ContentType.X_WWW_FORM_URLENCODED) {
          body.split('&').forEach((item: string) => {
            const [ key, value] = item.split('=');
            result.body[key] = value;
          });
          resolve();
        } else {
          result.body = body;
          resolve();
        }
      });
    })
  }
  return result;
}
