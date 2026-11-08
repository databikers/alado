import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer, RequestAuthentication, validate } from '../../src';
import { baseOptions, close, listen, send, sendJson } from '../helpers/http';

const unauthorized = { statusCode: 401, message: 'Unauthorized' };
const context = (auth: RequestAuthentication, request: any = {}) =>
  ({
    title: 'auth input',
    auth,
    request,
    options: { allowUnknownFields: false },
    response: { statusCode: 200, body: { ok: true } },
  }) as any;

describe('auth input checked before the auth handler', () => {
  const app = new AladoServer(baseOptions('auth-input'));
  const seen: unknown[] = [];
  const handler = async (token: unknown) => {
    seen.push(token);
    return token === 'secret' || token === 'abcdef' ? { id: 1 } : null;
  };
  const auth = (inputProperty: string): RequestAuthentication => ({
    inputProperty,
    outputProperty: 'auth.user',
    required: true,
    handler,
    error: unauthorized,
  });
  let port: number;

  before(async () => {
    const ok = async () => ({ statusCode: 200, body: { ok: true } });
    app.post('/body', context(auth('body.token')), ok);
    app.get('/query', context(auth('query.token')), ok);
    app.post(
      '/declared',
      context(auth('body.token'), {
        body: {
          token: {
            validation: { required: true, handler: validate.string().length(6).build(), error: unauthorized },
          },
        },
      }),
      ok,
    );
    port = await listen(app);
  });

  after(() => close(app));

  it('accepts a string token', async () => {
    seen.length = 0;
    assert.equal((await sendJson(port, 'POST', '/body', { token: 'secret' })).status, 200);
    assert.deepEqual(seen, ['secret']);
  });

  it('refuses an object from a JSON body without calling the handler', async () => {
    seen.length = 0;
    const r = await sendJson(port, 'POST', '/body', { token: { $ne: null } });
    assert.equal(r.status, 401);
    assert.deepEqual(seen, []);
  });

  it('refuses a repeated query key (an array) without calling the handler', async () => {
    seen.length = 0;
    assert.equal((await send(port, { path: '/query?token=secret&token=x' })).status, 401);
    assert.deepEqual(seen, []);
  });

  it('runs the validator declared for the auth field before the handler', async () => {
    seen.length = 0;
    assert.equal((await sendJson(port, 'POST', '/declared', { token: 'abc' })).status, 401);
    assert.deepEqual(seen, []);
    assert.equal((await sendJson(port, 'POST', '/declared', { token: 'abcdef' })).status, 200);
    assert.deepEqual(seen, ['abcdef']);
  });
});
