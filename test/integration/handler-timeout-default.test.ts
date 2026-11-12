import { describe, it, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer } from '../../src';
import { baseOptions, close, listen, send } from '../helpers/http';

describe('handlerTimeoutMs default', () => {
  const apps: AladoServer[] = [];
  after(() => Promise.all(apps.map(close)));

  // a server whose /never handler does not answer; `reached` resolves once the handler runs
  async function start(extra: Record<string, unknown> = {}) {
    let reached!: () => void;
    const handlerRan = new Promise<void>((resolve) => (reached = resolve));
    const app = new AladoServer(
      baseOptions(`handler-timeout-default-${apps.length}`, { logger: { log() {}, error() {} }, ...extra }),
    );
    app.get(
      '/never',
      { title: 't', options: { allowUnknownFields: false }, request: {}, response: { statusCode: 204 } } as any,
      () => {
        reached();
        return new Promise(() => {});
      },
    );
    apps.push(app);
    return { port: await listen(app), handlerRan };
  }

  it('answers 503 after 60 seconds when handlerTimeoutMs is left out', async (t) => {
    const { port, handlerRan } = await start();
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const answer = send(port, { path: '/never' });
    await handlerRan;
    let settled = false;
    answer.then(() => (settled = true));
    t.mock.timers.tick(59_999);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false, 'answered before 60 s');
    t.mock.timers.tick(1);
    const r = await answer;
    assert.equal(r.status, 503);
  });

  it('keeps no limit with handlerTimeoutMs: 0', async (t) => {
    const { port, handlerRan } = await start({ handlerTimeoutMs: 0 });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let settled = false;
    send(port, { path: '/never' }).then(
      () => (settled = true),
      () => (settled = true),
    );
    await handlerRan;
    t.mock.timers.tick(24 * 60 * 60 * 1000);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    mock.timers.reset();
  });
});
