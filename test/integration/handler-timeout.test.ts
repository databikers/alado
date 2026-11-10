import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer } from '../../src';
import { baseOptions, close, listen, send } from '../helpers/http';

describe('handlerTimeoutMs', () => {
  let app: AladoServer;
  let port: number;
  const logged: string[] = [];

  before(async () => {
    app = new AladoServer(
      baseOptions('handler-timeout', {
        handlerTimeoutMs: 60,
        logger: { log() {}, error: (e: any) => logged.push(String(e?.message ?? e)) },
      }),
    );
    const route = (path: string, handler: () => any) =>
      app.get(
        path,
        { title: 't', options: { allowUnknownFields: false }, request: {}, response: { statusCode: 204 } } as any,
        handler,
      );
    route('/never', () => new Promise(() => {}));
    route('/late-reject', () => new Promise((_, reject) => setTimeout(() => reject(new Error('late')), 120)));
    route('/fast', async () => ({
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { ok: true },
    }));
    route('/sync', () => ({ statusCode: 204 }));
    port = await listen(app);
  });

  after(() => close(app));

  it('answers 503 and closes the connection when a handler does not answer in time', async () => {
    const started = Date.now();
    const r = await send(port, { path: '/never' });
    assert.deepEqual(
      [
        r.status,
        r.json(),
      ],
      [
        503,
        { message: 'Service Unavailable' },
      ],
    );
    assert.equal(r.headers.connection, 'close');
    assert.ok(Date.now() - started < 1000);
    assert.ok(
      logged.some((m) => m === 'Handler of GET /never did not answer within 60 ms'),
      logged.join(),
    );
  });

  it('ignores what the handler does after the timeout, a late rejection included', async () => {
    const r = await send(port, { path: '/late-reject' });
    assert.equal(r.status, 503);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal((await send(port, { path: '/fast' })).status, 200, 'the process is still serving');
  });

  it('leaves handlers that answer in time alone, async or not', async () => {
    assert.deepEqual((await send(port, { path: '/fast' })).json(), { ok: true });
    assert.equal((await send(port, { path: '/sync' })).status, 204);
  });

  it('is off by default and refuses values that are not a duration', () => {
    assert.throws(
      () => new AladoServer(baseOptions('handler-timeout-bad', { handlerTimeoutMs: -1 })),
      /handlerTimeoutMs should be a number of milliseconds/,
    );
    assert.throws(
      () => new AladoServer(baseOptions('handler-timeout-nan', { handlerTimeoutMs: NaN })),
      /handlerTimeoutMs/,
    );
    new AladoServer(baseOptions('handler-timeout-off', { handlerTimeoutMs: 0 }));
  });
});
