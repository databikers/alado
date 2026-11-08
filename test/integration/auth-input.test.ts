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
    app.post('/optional', context({ ...auth('body.token'), required: false }), async (req: any) => ({
      statusCode: 200,
      body: { auth: req.auth },
    }));
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

  it('treats an optional auth with an invalid input as anonymous', async () => {
    seen.length = 0;
    const r = await sendJson(port, 'POST', '/optional', { token: { $ne: null } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json(), { auth: {} });
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

describe('auth handler failures', () => {
  const logged: unknown[] = [];
  const app = new AladoServer(
    baseOptions('auth-handler-failures', {
      logger: { log: () => undefined, error: (e: unknown) => logged.push(e) },
    }),
  );
  const throwing = (required: boolean): RequestAuthentication => ({
    inputProperty: 'headers.authorization',
    outputProperty: 'auth.user',
    required,
    handler: async () => {
      throw new Error('token service down');
    },
    error: unauthorized,
  });
  let port: number;

  before(async () => {
    app.get('/required', context(throwing(true)), async () => ({ statusCode: 200, body: { ok: true } }));
    app.get('/optional', context(throwing(false)), async (req: any) => ({ statusCode: 200, body: { auth: req.auth } }));
    port = await listen(app);
  });

  after(() => close(app));

  it('refuses a required auth and logs the handler error', async () => {
    logged.length = 0;
    const r = await send(port, { path: '/required', headers: { authorization: 'x' } });
    assert.equal(r.status, 401);
    assert.deepEqual(r.json(), { message: 'Unauthorized' });
    assert.equal((logged[0] as Error).message, 'token service down');
  });

  it('lets an optional auth through anonymously and logs the handler error', async () => {
    logged.length = 0;
    const r = await send(port, { path: '/optional', headers: { authorization: 'x' } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json(), { auth: {} });
    assert.equal((logged[0] as Error).message, 'token service down');
  });
});
