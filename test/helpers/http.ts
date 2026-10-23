import http from 'http';
import { AddressInfo } from 'net';
import { AladoServer } from '../../src';

export type RawResponse = {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
  json: () => any;
};

export type RawRequest = {
  method?: string;
  path: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
};

/**
 * Plain node:http client. fetch() is deliberately not used: it normalises
 * paths (drops `..` segments) and rejects some methods, which would hide
 * exactly the behaviour these tests need to see.
 */
export function send(port: number, req: RawRequest): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string | number> = { ...(req.headers || {}) };
    if (req.body !== undefined) {
      headers['Content-Length'] = Buffer.byteLength(req.body);
    }
    const r = http.request(
      { host: '127.0.0.1', port, method: req.method || 'GET', path: req.path, headers, agent: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: res.statusCode as number,
            headers: res.headers,
            text,
            json: () => JSON.parse(text),
          });
        });
      },
    );
    r.setTimeout(3000, () => r.destroy(new Error(`timeout: ${req.method || 'GET'} ${req.path}`)));
    r.on('error', reject);
    if (req.body !== undefined) {
      r.write(req.body);
    }
    r.end();
  });
}

export function sendJson(
  port: number,
  method: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return send(port, {
    method,
    path,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

export function multipart(
  parts: Array<{ name: string; value: string | Buffer; filename?: string; contentType?: string }>,
): { body: Buffer; contentType: string } {
  const boundary = '----aladotest' + Math.random().toString(16).slice(2);
  const chunks: Buffer[] = [];
  for (const p of parts) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"`;
    if (p.filename) {
      head += `; filename="${p.filename}"`;
    }
    head += '\r\n';
    if (p.contentType) {
      head += `Content-Type: ${p.contentType}\r\n`;
    }
    head += '\r\n';
    chunks.push(
      Buffer.from(head, 'utf8'),
      Buffer.isBuffer(p.value) ? p.value : Buffer.from(p.value, 'utf8'),
      Buffer.from('\r\n'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

export function listen(app: AladoServer): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = app.start((err?: Error) => {
      if (err) {
        return reject(err);
      }
      resolve((server.address() as AddressInfo).port);
    });
  });
}

export function close(app: AladoServer): Promise<void> {
  return new Promise((resolve) => {
    if (!app.listening) {
      return resolve();
    }
    app.stop(() => resolve());
  });
}

export const silentLogger = { log: () => undefined, error: () => undefined };

export function baseOptions(appId: string, extra: Record<string, unknown> = {}) {
  return {
    appId,
    port: 0,
    host: '127.0.0.1',
    logger: silentLogger,
    cors: { enable: false },
    openApiDoc: { enable: false, route: '/docs', info: {} },
    ...extra,
  } as any;
}
