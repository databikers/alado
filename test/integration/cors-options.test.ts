import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer, defineResponse, get, initializeApplication } from '../../src';
import { baseOptions, close, listen, send } from '../helpers/http';

const json = { 'Content-Type': 'application/json' };
const allowed = 'https://app.example.com';
const appId = 'cors-options';

class ThingsController {
  @get('/things', { appId })
  @defineResponse({ statusCode: 200, headers: json, body: { ok: true } })
  async list() {
    return { statusCode: 200, headers: json, body: { ok: true } };
  }
}

let app: AladoServer;
let port: number;

before(async () => {
  app = initializeApplication({
    serverOptions: baseOptions(appId, {
      cors: { enable: true, allowedOrigin: [allowed], allowedCredentials: true, maxAge: 0 },
    }),
    controllers: [ThingsController],
  });
  port = await listen(app);
});

after(() => close(app));

describe('CORS preflight', () => {
  it('sends maxAge 0 as it is', async () => {
    const r = await send(port, { method: 'OPTIONS', path: '/things', headers: { Origin: allowed } });
    assert.equal(r.status, 204);
    assert.equal(r.headers['access-control-max-age'], '0');
  });

  it('reflects an allowed origin', async () => {
    const r = await send(port, { method: 'OPTIONS', path: '/things', headers: { Origin: allowed } });
    assert.equal(r.headers['access-control-allow-origin'], allowed);
    assert.equal(r.headers['access-control-allow-credentials'], 'true');
  });

  it('does not allow an origin outside the list', async () => {
    const r = await send(port, { method: 'OPTIONS', path: '/things', headers: { Origin: 'https://evil.example' } });
    assert.equal(r.headers['access-control-allow-origin'], undefined);
  });
});
