import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer } from '../../src';
import { baseOptions, close, listen, send } from '../helpers/http';

const json = { 'Content-Type': 'application/json' };
const ctx = () => ({ title: 't', request: {}, response: { statusCode: 200, body: {} } }) as any;
const ok = async () => ({ statusCode: 200, headers: json, body: { ok: true } });

function register(app: AladoServer) {
  app.get('/items', ctx(), ok);
  app.post('/items', ctx(), ok);
  app.get('/items/:id', ctx(), ok);
  app.put('/items/:id', ctx(), ok);
  app.delete('/items/:id', ctx(), ok);
  app.patch('/items/featured', ctx(), ok);
}

describe('405 Method Not Allowed', () => {
  let app: AladoServer;
  let port: number;

  before(async () => {
    app = new AladoServer(baseOptions('method-not-allowed'));
    register(app);
    port = await listen(app);
  });

  after(() => close(app));

  it('answers a known static path with 405 and the methods it accepts', async () => {
    const r = await send(port, { method: 'DELETE', path: '/items' });
    assert.equal(r.status, 405);
    assert.equal(r.headers.allow, 'GET, POST');
    assert.deepEqual(r.json(), { message: 'Method Not Allowed' });
  });

  it('lists the methods of every route shape that matches the path', async () => {
    const r = await send(port, { method: 'POST', path: '/items/42' });
    assert.equal(r.status, 405);
    assert.equal(r.headers.allow, 'GET, PUT, DELETE');
    // /items/featured also matches /items/:id, so both routes' methods are allowed
    const f = await send(port, { method: 'POST', path: '/items/featured' });
    assert.equal(f.headers.allow, 'GET, PUT, PATCH, DELETE');
  });

  it('applies to HEAD and to methods the router does not know', async () => {
    assert.equal((await send(port, { method: 'HEAD', path: '/items' })).status, 405);
    const r = await send(port, { method: 'PROPFIND', path: '/items' });
    assert.equal(r.status, 405);
    assert.equal(r.headers.allow, 'GET, POST');
  });

  it('still answers 404 for a path no method has', async () => {
    for (const [
      method,
      path,
    ] of [
      [
        'GET',
        '/nope',
      ],
      [
        'POST',
        '/items/42/extra',
      ],
      [
        'DELETE',
        '/',
      ],
    ]) {
      const r = await send(port, { method, path });
      assert.equal(r.status, 404, `${method} ${path}`);
      assert.equal(r.headers.allow, undefined);
    }
  });

  it('still serves a route that exists for the method', async () => {
    assert.equal((await send(port, { method: 'PUT', path: '/items/42' })).status, 200);
  });
});

describe('405 with CORS enabled', () => {
  let app: AladoServer;
  let port: number;

  before(async () => {
    app = new AladoServer(
      baseOptions('method-not-allowed-cors', {
        cors: { enable: true, allowedOrigin: ['https://app.example'] },
      }),
    );
    register(app);
    port = await listen(app);
  });

  after(() => close(app));

  it('includes OPTIONS in Allow and keeps the CORS headers', async () => {
    const r = await send(port, { method: 'DELETE', path: '/items', headers: { Origin: 'https://app.example' } });
    assert.equal(r.status, 405);
    assert.equal(r.headers.allow, 'GET, POST, OPTIONS');
    assert.equal(r.headers['access-control-allow-origin'], 'https://app.example');
    assert.equal(r.headers.vary, 'Origin');
  });

  it('still answers preflights', async () => {
    const r = await send(port, { method: 'OPTIONS', path: '/items/7', headers: { Origin: 'https://app.example' } });
    assert.equal(r.status, 204);
  });
});
