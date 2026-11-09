import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer, defineResponse, initializeApplication, post } from '../../src';
import { baseOptions, close, listen, send } from '../helpers/http';

const json = { 'Content-Type': 'application/json' };
const allowed = 'https://app.example.com';
const appId = 'cors-error-responses';

class EchoController {
  @post('/echo', { appId, rawBody: true })
  @defineResponse({ statusCode: 200, headers: json, body: { ok: true } })
  async echo() {
    return { statusCode: 200, headers: json, body: { ok: true } };
  }
}

let app: AladoServer;
let port: number;

before(async () => {
  app = initializeApplication({
    serverOptions: baseOptions(appId, { cors: { enable: true, allowedOrigin: [allowed] }, maxBodySizeBytes: 16 }),
    controllers: [EchoController],
  });
  port = await listen(app);
});

after(() => close(app));

describe('CORS headers on errors raised while reading the body', () => {
  it('are sent with 400 for an invalid JSON body', async () => {
    const r = await send(port, {
      method: 'POST',
      path: '/echo',
      headers: { ...json, Origin: allowed },
      body: '{"broken"',
    });
    assert.equal(r.status, 400);
    assert.equal(r.headers['access-control-allow-origin'], allowed);
    assert.equal(r.headers.vary, 'Origin');
  });

  it('are sent with 413 for an oversized body', async () => {
    const r = await send(port, {
      method: 'POST',
      path: '/echo',
      headers: { ...json, Origin: allowed },
      body: JSON.stringify({ text: 'x'.repeat(64) }),
    });
    assert.equal(r.status, 413);
    assert.equal(r.headers['access-control-allow-origin'], allowed);
  });
});
