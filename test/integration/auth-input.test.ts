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

describe('validator of the auth field', () => {
  const app = new AladoServer(baseOptions('auth-validator-once'));
  let calls = 0;
  const counted = (v: unknown) => {
    calls++;
    return typeof v === 'string';
  };
  let port: number;

  before(async () => {
    app.get(
      '/header',
      context(
        {
          inputProperty: 'headers.x-key',
          outputProperty: 'auth.user',
          required: true,
          handler: async (k: string) => (k === 'abc' ? { id: 1 } : null),
          error: unauthorized,
        },
        { headers: { 'x-key': { validation: { required: true, handler: counted, error: unauthorized } } } },
      ),
      async () => ({ statusCode: 200, body: { ok: true } }),
    );
    app.get(
      '/numeric',
      context(
        {
          inputProperty: 'query.key',
          outputProperty: 'auth.user',
          required: true,
          handler: async (k: unknown) => (k === '42' ? { id: 1 } : null),
          error: unauthorized,
        },
        {
          query: {
            key: {
              validation: { required: true, handler: validate.number().integer().buildSync(), error: unauthorized },
            },
          },
        },
      ),
      async (req: any) => ({ statusCode: 200, body: { key: req.query.key, type: typeof req.query.key } }),
    );
    port = await listen(app);
  });

  after(() => close(app));

  it('runs once per request', async () => {
    calls = 0;
    assert.equal((await send(port, { path: '/header', headers: { 'x-key': 'abc' } })).status, 200);
    assert.equal(calls, 1);
  });

  it('sees query and path values converted for number() / bigint(), as in request validation', async () => {
    const r = await send(port, { path: '/numeric?key=42' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json(), { key: 42, type: 'number' });
    assert.equal((await send(port, { path: '/numeric?key=4x2' })).status, 401);
  });
});

describe('logging of auth handler exceptions', () => {
  const run = async (verbose: boolean) => {
    const logged: unknown[] = [];
    const app = new AladoServer(
      baseOptions(`auth-handler-logging-${verbose}`, {
        verbose,
        logger: { log: () => undefined, error: (e: unknown) => logged.push(e) },
      }),
    );
    app.get(
      '/me',
      context({
        inputProperty: 'headers.authorization',
        outputProperty: 'auth.user',
        required: true,
        handler: async (token: string) => {
          if (token === 'expired') {
            throw Object.assign(new Error('token expired'), { statusCode: 401 });
          }
          if (token === 'rejected') {
            throw { statusCode: 403 };
          }
          throw new Error('token service down');
        },
        error: unauthorized,
      }),
      async () => ({ statusCode: 200, body: { ok: true } }),
    );
    const port = await listen(app);
    try {
      for (const token of [
        'expired',
        'rejected',
        'other',
      ]) {
        assert.equal((await send(port, { path: '/me', headers: { authorization: token } })).status, 401);
      }
    } finally {
      await close(app);
    }
    return logged.map((e: any) => e.message ?? `statusCode ${e.statusCode}`);
  };

  it('logs refusals marked with a 4xx statusCode only in verbose mode, failures always', async () => {
    assert.deepEqual(await run(false), ['token service down']);
    assert.deepEqual(await run(true), [
      'token expired',
      'statusCode 403',
      'token service down',
    ]);
  });
});
