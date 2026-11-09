import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'net';
import { AladoServer, AladoConfigurationError } from '../../src';
import { baseOptions, close, listen } from '../helpers/http';

const LIMIT = 64;
const json = { 'Content-Type': 'application/json' };

/** Writes raw requests on one connection; resolves with everything read until the server closes or `ms` passes. */
function exchange(port: number, writes: Array<string | Buffer>, ms = 400): Promise<{ text: string; closed: boolean }> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    let text = '';
    let closed = false;
    socket.on('data', (d) => (text += d.toString('latin1')));
    socket.on('error', () => {});
    socket.on('close', () => {
      closed = true;
    });
    for (const w of writes) {
      socket.write(w);
    }
    setTimeout(() => {
      socket.destroy();
      resolve({ text, closed });
    }, ms);
  });
}

const request = (method: string, path: string, body: string, headers: Record<string, string> = {}) =>
  `${method} ${path} HTTP/1.1\r\nHost: x\r\n${Object.entries({
    'Content-Length': String(Buffer.byteLength(body)),
    ...headers,
  })
    .map(
      ([
        k,
        v,
      ]) => `${k}: ${v}\r\n`,
    )
    .join('')}\r\n${body}`;
const statuses = (text: string) => [...text.matchAll(/HTTP\/1\.1 (\d{3})/g)].map((m) => Number(m[1]));

describe('a body the route does not declare', () => {
  let app: AladoServer;
  let port: number;

  before(async () => {
    app = new AladoServer(baseOptions('unread-body', { maxBodySizeBytes: LIMIT }));
    const context = (options: Record<string, unknown> = {}) =>
      ({
        title: 't',
        options: { allowUnknownFields: false, ...options },
        request: {},
        response: { statusCode: 200, body: {} },
      }) as any;
    const echo = async (r: any) => ({
      statusCode: 200,
      headers: json,
      body: { body: r.body, rawBody: r.rawBody ?? null },
    });
    app.post('/undeclared', context(), echo);
    app.post('/raw', context({ rawBody: true }), echo);
    app.get('/items', context(), echo);
    port = await listen(app);
  });

  after(() => close(app));

  it('is not read or parsed: an invalid JSON body does not matter', async () => {
    const { text } = await exchange(port, [request('POST', '/undeclared', '{oops', { ...json, Connection: 'close' })]);
    assert.equal(statuses(text)[0], 200);
    assert.ok(text.endsWith('{"body":{},"rawBody":null}'), text);
  });

  it('is read with rawBody: true', async () => {
    const { text } = await exchange(port, [
      request('POST', '/raw', 'signed payload', { 'Content-Type': 'text/plain', Connection: 'close' }),
    ]);
    assert.equal(statuses(text)[0], 200);
    assert.ok(text.endsWith('"rawBody":"signed payload"}'), text);
  });

  it('within the limit keeps the connection: the next request on it is answered', async () => {
    for (const first of [
      request('POST', '/undeclared', '{"a":1}', json),
      request('GET', '/items', 'xx'),
      request('DELETE', '/nowhere', 'xx'),
      request('PATCH', '/items', 'xx'),
    ]) {
      const { text } = await exchange(port, [
        first,
        request('GET', '/items', ''),
      ]);
      assert.deepEqual(statuses(text).length, 2, text);
      assert.doesNotMatch(text, /connection: close/i);
    }
  });

  it('over the limit, or chunked, closes the connection instead of reading it', async () => {
    const big = `POST /nowhere HTTP/1.1\r\nHost: x\r\nContent-Length: ${10 * 1024 * 1024}\r\n\r\n` + 'x'.repeat(16);
    const r404 = await exchange(port, [big]);
    assert.equal(statuses(r404.text)[0], 404);
    assert.match(r404.text, /connection: close/i);
    assert.equal(r404.closed, true, 'the server does not wait for the 10 MB');

    const chunked = 'GET /items HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n4\r\nabcd\r\n';
    const r200 = await exchange(port, [chunked]);
    assert.equal(statuses(r200.text)[0], 200);
    assert.match(r200.text, /connection: close/i);
    assert.equal(r200.closed, true);
  });

  it('rawBody: true on a method without a body is a configuration error', () => {
    assert.throws(
      () =>
        app.get(
          '/raw-get',
          {
            title: 't',
            options: { allowUnknownFields: false, rawBody: true },
            request: {},
            response: { statusCode: 204 },
          } as any,
          async () => ({ statusCode: 204 }),
        ),
      (e: any) =>
        e instanceof AladoConfigurationError && e.code === 'BODY_NOT_ALLOWED' && e.message.includes('options.rawBody'),
    );
  });
});
