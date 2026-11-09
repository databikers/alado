import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { AladoServer } from '../../src';
import { baseOptions, close, listen, send } from '../helpers/http';

const json = { 'Content-Type': 'application/json' };
const ctx = () => ({ title: 't', request: {}, response: { statusCode: 200, body: {} } }) as any;

describe('HEAD is served by GET routes', () => {
  let app: AladoServer;
  let port: number;
  let getCalls = 0;
  let streamRead = false;
  let streamClosed = false;

  before(async () => {
    app = new AladoServer(baseOptions('head'));
    app.get('/doc', ctx(), async () => {
      getCalls++;
      return { statusCode: 200, headers: { ...json, 'X-Doc': '1' }, body: { hello: 'world' } };
    });
    app.get('/file', ctx(), async () => {
      const stream = new Readable({
        read() {
          streamRead = true;
          this.push('data');
          this.push(null);
        },
      });
      stream.on('close', () => {
        streamClosed = true;
      });
      return { statusCode: 200, headers: { 'Content-Type': 'text/plain' }, body: stream };
    });
    app.get('/own', ctx(), async () => ({ statusCode: 200, headers: json, body: { from: 'get' } }));
    app.head('/own', ctx(), async () => ({ statusCode: 204, headers: { 'X-From': 'head' } }));
    port = await listen(app);
  });

  after(() => close(app));

  it('answers with the GET status and headers and no body', async () => {
    const g = await send(port, { method: 'GET', path: '/doc' });
    const h = await send(port, { method: 'HEAD', path: '/doc' });
    assert.equal(h.status, 200);
    assert.equal(h.headers['x-doc'], '1');
    assert.equal(h.headers['content-type'], g.headers['content-type']);
    assert.equal(h.headers['content-length'], g.headers['content-length']);
    assert.equal(h.text, '');
    assert.equal(getCalls, 2);
  });

  it('does not read a streamed body and closes the stream', async () => {
    const h = await send(port, { method: 'HEAD', path: '/file' });
    assert.equal(h.status, 200);
    assert.equal(h.text, '');
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(streamRead, false);
    assert.equal(streamClosed, true);
  });

  it('prefers a declared HEAD route', async () => {
    const h = await send(port, { method: 'HEAD', path: '/own' });
    assert.equal(h.status, 204);
    assert.equal(h.headers['x-from'], 'head');
  });

  it('lists HEAD in Allow next to GET', async () => {
    const r = await send(port, { method: 'DELETE', path: '/doc' });
    assert.equal(r.status, 405);
    assert.equal(r.headers.allow, 'GET, HEAD');
  });
});
