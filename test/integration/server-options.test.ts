import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import https from 'https';
import { AladoServer } from '../../src';
import { baseOptions, close, listen, send } from '../helpers/http';

const json = { 'Content-Type': 'application/json' };
// the server instance is private; reading it is the only way to see which one was created
const serverOf = (app: AladoServer): http.Server => (app as any).server;
const context = { title: 'ok', request: {}, response: { statusCode: 200, body: {} } } as any;

describe('serverOptions and ssl', () => {
  it('keeps a plain HTTP server when only serverOptions are given, and applies them', async () => {
    const app = new AladoServer(
      baseOptions('server-options-http', { serverOptions: { requestTimeout: 12345, headersTimeout: 6789 } }),
    );
    app.get('/ok', context, async () => ({ statusCode: 200, headers: json, body: { ok: true } }));
    assert.equal(serverOf(app) instanceof https.Server, false);
    assert.equal(serverOf(app) instanceof http.Server, true);
    assert.equal(serverOf(app).requestTimeout, 12345);
    assert.equal(serverOf(app).headersTimeout, 6789);
    const port = await listen(app);
    try {
      const res = await send(port, { path: '/ok' });
      assert.equal(res.status, 200);
      assert.deepEqual(res.json(), { ok: true });
    } finally {
      await close(app);
    }
  });

  it('uses HTTPS when ssl is given, with serverOptions applied as well', () => {
    const app = new AladoServer(
      baseOptions('server-options-https', { ssl: { ciphers: 'HIGH' }, serverOptions: { requestTimeout: 4321 } }),
    );
    assert.equal(serverOf(app) instanceof https.Server, true);
    assert.equal(serverOf(app).requestTimeout, 4321);
  });

  it('keeps a plain HTTP server for an empty ssl object', () => {
    const app = new AladoServer(baseOptions('server-options-empty-ssl', { ssl: {} }));
    assert.equal(serverOf(app) instanceof https.Server, false);
  });
});
