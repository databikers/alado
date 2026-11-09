import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'net';
import { AladoServer } from '../../src';
import { requestTarget } from '../../src/request-processor/request-processor';
import { baseOptions, close, listen } from '../helpers/http';

const context = {
  title: 't',
  request: {},
  options: { allowUnknownFields: true },
  response: { statusCode: 200, body: {} },
} as any;

// a raw request line: HTTP clients always send origin-form
const statusAndBody = (port: number, target: string) =>
  new Promise<string>((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    let out = '';
    socket.on('data', (c) => (out += c));
    socket.on('end', () => {
      const [
        head,
        body,
      ] = out.split('\r\n\r\n');
      resolve(`${head.split('\r\n')[0]} ${body}`);
    });
    socket.on('error', reject);
    socket.write(`GET ${target} HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n`);
  });

describe('request targets', () => {
  it('reduce the absolute form to path and query', () => {
    assert.equal(requestTarget('/items?x=1'), '/items?x=1');
    assert.equal(requestTarget('http://example.com/items?x=1'), '/items?x=1');
    assert.equal(requestTarget('https://user@example.com:8443/a/b'), '/a/b');
    assert.equal(requestTarget('http://example.com'), '/');
    assert.equal(requestTarget('http://example.com?x=1'), '/?x=1');
    assert.equal(requestTarget('*'), '*');
  });

  describe('over HTTP', () => {
    const app = new AladoServer(baseOptions('request-target'));
    let port: number;

    before(async () => {
      app.get('/items', context, async (req: any) => ({ statusCode: 200, body: { q: req.query.q, url: req.url } }));
      app.get('/', context, async () => ({ statusCode: 200, body: { root: true } }));
      port = await listen(app);
    });

    after(() => close(app));

    it('route an absolute-form target like the origin-form one', async () => {
      assert.equal(await statusAndBody(port, '/items?q=1'), 'HTTP/1.1 200 OK {"q":"1","url":"/items?q=1"}');
      assert.equal(
        await statusAndBody(port, 'http://example.com/items?q=1'),
        'HTTP/1.1 200 OK {"q":"1","url":"/items?q=1"}',
      );
      assert.equal(await statusAndBody(port, 'http://example.com'), 'HTTP/1.1 200 OK {"root":true}');
    });
  });
});
