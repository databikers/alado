import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer, RequestAuthentication } from '../../src';
import { baseOptions, close, listen, send } from '../helpers/http';

const json = { 'Content-Type': 'application/json' };
const headerAuth: RequestAuthentication = {
  inputProperty: 'headers.authorization',
  outputProperty: 'auth.user',
  required: true,
  handler: async (token: string) => (token === 'secret' ? { id: 1 } : null),
  error: { statusCode: 401, message: 'Unauthorized' },
};
const context = (extra: any = {}) =>
  ({
    title: 'auth before body',
    auth: headerAuth,
    request: {},
    options: { allowUnknownFields: true },
    response: { statusCode: 200, body: { ok: true } },
    ...extra,
  }) as any;

describe('body read after header authentication', () => {
  const app = new AladoServer(baseOptions('auth-before-body', { maxBodySizeBytes: 64 }));
  let port: number;

  before(async () => {
    app.post('/items', context(), async (req: any) => ({ statusCode: 200, body: { body: req.body } }));
    app.post(
      '/owned',
      context({
        accessControl: [
          { inputProperty: 'body.ownerId', expectedValue: 1, statusCode: 403, message: 'Forbidden' },
        ],
      }),
      async () => ({ statusCode: 200, body: { ok: true } }),
    );
    port = await listen(app);
  });

  after(() => close(app));

  it('refuses an unauthenticated request before reading its body', async () => {
    // invalid and oversized: reading it would answer 400 or 413
    const r = await send(port, { method: 'POST', path: '/items', headers: json, body: '{"broken' + 'x'.repeat(200) });
    assert.equal(r.status, 401);
    assert.equal(r.headers.connection, 'close');
  });

  it('reads the body once authenticated', async () => {
    const r = await send(port, {
      method: 'POST',
      path: '/items',
      headers: { ...json, Authorization: 'secret' },
      body: '{"a":1}',
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json(), { body: { a: 1 } });
  });

  it('still answers 400 to an invalid body once authenticated', async () => {
    const r = await send(port, {
      method: 'POST',
      path: '/items',
      headers: { ...json, Authorization: 'secret' },
      body: '{"broken',
    });
    assert.equal(r.status, 400);
  });

  it('reads the body before access control rules that use it', async () => {
    const send1 = (ownerId: number) =>
      send(port, {
        method: 'POST',
        path: '/owned',
        headers: { ...json, Authorization: 'secret' },
        body: JSON.stringify({ ownerId }),
      });
    assert.equal((await send1(1)).status, 200);
    assert.equal((await send1(2)).status, 403);
  });
});
