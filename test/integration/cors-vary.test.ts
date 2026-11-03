import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer, defineResponse, get, initializeApplication } from '../../src';
import { baseOptions, close, listen, send } from '../helpers/http';

const json = { 'Content-Type': 'application/json' };
const doc = defineResponse({ statusCode: 200, headers: json, body: { ok: true } });
const allowed = 'https://app.example.com';

class ListController {
  @get('/plain', { appId: 'cors-vary-list' })
  @doc
  async plain() {
    return { statusCode: 200, headers: json, body: { ok: true } };
  }

  @get('/own-vary', { appId: 'cors-vary-list' })
  @doc
  async ownVary() {
    return { statusCode: 200, headers: { ...json, vary: 'Accept-Encoding' }, body: { ok: true } };
  }
}

class FixedController {
  @get('/plain', { appId: 'cors-vary-fixed' })
  @doc
  async plain() {
    return { statusCode: 200, headers: json, body: { ok: true } };
  }
}

let list: AladoServer;
let fixed: AladoServer;
let listPort: number;
let fixedPort: number;

before(async () => {
  list = initializeApplication({
    serverOptions: baseOptions('cors-vary-list', { cors: { enable: true, allowedOrigin: [allowed] } }),
    controllers: [ListController],
  });
  fixed = initializeApplication({
    serverOptions: baseOptions('cors-vary-fixed', { cors: { enable: true, allowedOrigin: allowed } }),
    controllers: [FixedController],
  });
  listPort = await listen(list);
  fixedPort = await listen(fixed);
});

after(async () => {
  await close(list);
  await close(fixed);
});

describe('CORS Vary: Origin', () => {
  it('is sent when an allowed origin is reflected', async () => {
    const r = await send(listPort, { path: '/plain', headers: { Origin: allowed } });
    assert.equal(r.headers['access-control-allow-origin'], allowed);
    assert.equal(r.headers.vary, 'Origin');
  });

  it('is sent when the origin is refused too', async () => {
    const r = await send(listPort, { path: '/plain', headers: { Origin: 'https://evil.example' } });
    assert.equal(r.headers['access-control-allow-origin'], undefined);
    assert.equal(r.headers.vary, 'Origin');
  });

  it('is sent on preflight responses', async () => {
    const r = await send(listPort, { method: 'OPTIONS', path: '/plain', headers: { Origin: allowed } });
    assert.equal(r.status, 204);
    assert.equal(r.headers.vary, 'Origin');
  });

  it('is merged with a Vary set by the handler', async () => {
    const r = await send(listPort, { path: '/own-vary', headers: { Origin: allowed } });
    assert.equal(r.headers.vary, 'Accept-Encoding, Origin');
  });

  it('is not needed for a fixed allowed origin', async () => {
    const r = await send(fixedPort, { path: '/plain', headers: { Origin: allowed } });
    assert.equal(r.headers['access-control-allow-origin'], allowed);
    assert.equal(r.headers.vary, undefined);
  });
});
