import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer } from '../../src';
import { baseOptions, close, listen, send } from '../helpers/http';

const apps: AladoServer[] = [];
const json = { 'Content-Type': 'application/json' };

async function start(extra: Record<string, unknown>, handlerHeaders: Record<string, string> = json) {
  const app = new AladoServer(baseOptions(`hardening-${apps.length}`, extra));
  const context = (accessControl?: unknown): any => ({
    title: 't',
    options: { allowUnknownFields: false },
    request: {},
    accessControl,
    response: { statusCode: 200, body: {} },
  });
  app.get('/x', context(), async () => ({ statusCode: 200, headers: handlerHeaders, body: {} }));
  app.get(
    '/key',
    context([
      { inputProperty: 'headers.x-api-key', expectedValue: 'secret-key', statusCode: 403, message: 'Forbidden' },
    ]),
    async () => ({ statusCode: 200, headers: json, body: {} }),
  );
  apps.push(app);
  return listen(app);
}

describe('hardening defaults', () => {
  after(() => Promise.all(apps.map(close)));

  it('send X-Content-Type-Options: nosniff on every response', async () => {
    const port = await start({ openApiDoc: { enable: true, route: '/docs', info: { title: 't', version: '1' } } });
    for (const path of [
      '/x',
      '/missing',
      '/docs',
      '/docs/swagger.json',
      '/docs/swagger-ui.css',
    ]) {
      assert.equal((await send(port, { path })).headers['x-content-type-options'], 'nosniff', path);
    }
    assert.equal(
      (await send(port, { method: 'POST', path: '/x' })).headers['x-content-type-options'],
      'nosniff',
      '405',
    );
  });

  it('leave the header to the handler or the server options when they set it', async () => {
    const byHandler = await start({}, { ...json, 'x-content-type-options': 'custom' });
    assert.equal((await send(byHandler, { path: '/x' })).headers['x-content-type-options'], 'custom');
    const byServer = await start({ headers: { 'X-Content-Type-Options': 'server' } });
    assert.equal((await send(byServer, { path: '/x' })).headers['x-content-type-options'], 'server');
    assert.equal((await send(byServer, { path: '/missing' })).headers['x-content-type-options'], 'server');
  });

  it('compare expectedValue as before, whatever the lengths', async () => {
    const port = await start({});
    const call = async (key?: string) =>
      (await send(port, { path: '/key', headers: key === undefined ? {} : { 'X-Api-Key': key } })).status;
    assert.equal(await call('secret-key'), 200);
    assert.equal(await call('secret-kez'), 403);
    assert.equal(await call('s'), 403);
    assert.equal(await call('secret-key-and-more'), 403);
    assert.equal(await call(), 403);
  });
});
