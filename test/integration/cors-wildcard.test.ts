import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer } from '../../src';
import { baseOptions, close, listen, send } from '../helpers/http';

const json = { 'Content-Type': 'application/json' };
const apps: AladoServer[] = [];

async function start(cors: Record<string, unknown>): Promise<number> {
  const app = new AladoServer(baseOptions('cors-wildcard', { cors: { enable: true, ...cors } }));
  app.get(
    '/x',
    { title: 't', options: { allowUnknownFields: false }, request: {}, response: { statusCode: 200, body: {} } } as any,
    async () => ({ statusCode: 200, headers: json, body: {} }),
  );
  apps.push(app);
  return listen(app);
}

const get = (port: number, origin?: string) =>
  send(port, { path: '/x', headers: origin ? { Origin: origin } : {} }).then((r) => r.headers);
const preflight = (port: number, origin: string) =>
  send(port, {
    method: 'OPTIONS',
    path: '/x',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' },
  }).then((r) => r.headers);

describe("CORS allowedOrigin '*'", () => {
  after(() => Promise.all(apps.map(close)));

  it("'*' in a list allows any origin, a listed one is sent back", async () => {
    const port = await start({
      allowedOrigin: [
        'https://a.com',
        '*',
      ],
    });
    assert.equal((await get(port, 'https://b.com'))['access-control-allow-origin'], '*');
    assert.equal((await get(port, 'https://a.com'))['access-control-allow-origin'], 'https://a.com');
    assert.equal((await preflight(port, 'https://b.com'))['access-control-allow-origin'], '*');
    assert.equal((await get(port, 'https://b.com')).vary, 'Origin');
  });

  it("'*' with credentials sends the request's Origin back, never '*' to a browser", async () => {
    const port = await start({ allowedOrigin: '*', allowedCredentials: true });
    for (const headers of [
      await get(port, 'https://b.com'),
      await preflight(port, 'https://b.com'),
    ]) {
      assert.equal(headers['access-control-allow-origin'], 'https://b.com');
      assert.equal(headers['access-control-allow-credentials'], 'true');
      assert.equal(headers.vary, 'Origin');
    }
    assert.equal((await get(port, 'null'))['access-control-allow-origin'], undefined, '"null" only when listed');
  });

  it('answers a request without Origin (server to server) under every configuration', async () => {
    for (const cors of [
      { allowedOrigin: '*' },
      { allowedOrigin: '*', allowedCredentials: true },
      { allowedOrigin: ['https://a.com'] },
    ]) {
      const port = await start(cors);
      const r = await send(port, { path: '/x' });
      assert.equal(r.status, 200, JSON.stringify(cors));
    }
  });

  it("keeps '*' cacheable for everyone without credentials", async () => {
    const port = await start({ allowedOrigin: '*' });
    const headers = await get(port, 'https://b.com');
    assert.equal(headers['access-control-allow-origin'], '*');
    assert.equal(headers.vary, undefined);
  });
});
