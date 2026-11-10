import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer } from '../../src';
import { baseOptions, close, listen, send } from '../helpers/http';

const apps: AladoServer[] = [];

async function start(cors: Record<string, unknown>): Promise<number> {
  const app = new AladoServer(baseOptions('cors-default-headers', { cors: { enable: true, ...cors } }));
  app.post(
    '/items',
    { title: 't', options: { allowUnknownFields: true }, request: {}, response: { statusCode: 200, body: {} } } as any,
    async () => ({ statusCode: 201 }),
  );
  apps.push(app);
  return listen(app);
}

const preflight = (port: number) =>
  send(port, {
    method: 'OPTIONS',
    path: '/items',
    headers: {
      Origin: 'https://app.example.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type, authorization',
    },
  }).then((r) => r.headers);

describe('CORS request headers', () => {
  after(() => Promise.all(apps.map(close)));

  it('allows Content-Type and Authorization when allowedHeaders is left out', async () => {
    const headers = await preflight(await start({}));
    assert.equal(headers['access-control-allow-headers'], 'Content-Type, Authorization');
  });

  it('uses allowedHeaders as given, and an explicit [] allows none', async () => {
    assert.equal(
      (await preflight(await start({ allowedHeaders: ['X-Api-Key'] })))['access-control-allow-headers'],
      'X-Api-Key',
    );
    assert.equal((await preflight(await start({ allowedHeaders: [] })))['access-control-allow-headers'], undefined);
  });

  it('leaves out empty headers and a "false" Allow-Credentials', async () => {
    const port = await start({});
    for (const headers of [
      await preflight(port),
      (await send(port, { method: 'POST', path: '/items', headers: { Origin: 'https://app.example.com' } })).headers,
    ]) {
      assert.equal(headers['access-control-expose-headers'], undefined);
      assert.equal(headers['access-control-allow-credentials'], undefined);
      assert.equal(headers['access-control-allow-origin'], '*');
    }
    const credentialed = await preflight(
      await start({ allowedOrigin: ['https://app.example.com'], allowedCredentials: true, exposeHeaders: ['X-Total'] }),
    );
    assert.equal(credentialed['access-control-allow-credentials'], 'true');
    assert.equal(credentialed['access-control-expose-headers'], 'X-Total');
  });
});
