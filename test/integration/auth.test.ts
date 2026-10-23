import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  AladoServer,
  Request,
  RequestAuthentication,
  accessControl,
  defineRequest,
  defineResponse,
  get,
  initializeApplication,
  patch,
  validate,
  validateProperty,
  withAuth,
} from '../../src';
import { baseOptions, close, listen, send, sendJson } from '../helpers/http';

const appId = 'auth';
const json = { 'Content-Type': 'application/json' };
const doc = defineResponse({ statusCode: 200, headers: json, body: { ok: true } });

const users: Record<string, { id: number; role: string }> = {
  'token-alice': { id: 1, role: 'user' },
  'token-bob': { id: 2, role: 'user' },
  'token-root': { id: 3, role: 'admin' },
};

const bearerAuth: RequestAuthentication = {
  inputProperty: 'headers.authorization',
  outputProperty: 'auth.user',
  required: true,
  handler: async (header: string) => {
    if (header === 'Bearer explode') {
      throw new Error('token service down');
    }
    return users[(header || '').replace(/^Bearer /, '')] || null;
  },
  error: { statusCode: 401, message: 'Unauthorized' },
};

const optionalAuth: RequestAuthentication = { ...bearerAuth, required: false };

const contextAuth: RequestAuthentication = {
  ...bearerAuth,
  handlerContext: { prefix: 'Token ' },
  handler: async function (this: { prefix: string }, header: string) {
    return header?.startsWith(this.prefix) ? { id: 99, role: 'svc' } : null;
  },
};

class UserIdPathDto {
  @validateProperty({
    required: true,
    handler: validate.string().regex(/^\d+$/).required().build(),
    error: { statusCode: 400, message: 'Bad id' },
  })
  id: string = '1';
}

class AuthController {
  @get('/me', { appId })
  @withAuth(bearerAuth)
  @doc
  async me(req: Request) {
    return { statusCode: 200, headers: json, body: req.auth };
  }

  @get('/maybe', { appId })
  @withAuth(optionalAuth)
  @doc
  async maybe(req: Request) {
    return { statusCode: 200, headers: json, body: req.auth };
  }

  @get('/service', { appId })
  @withAuth(contextAuth)
  @doc
  async service(req: Request) {
    return { statusCode: 200, headers: json, body: req.auth };
  }

  @patch('/users/:id', { appId })
  @accessControl([
    {
      inputProperty: 'auth.user.id',
      transformInputProperty: async (v: unknown) => String(v),
      compareWithProperty: 'path.id',
      statusCode: 403,
      message: 'Access Denied',
    },
  ])
  @withAuth(bearerAuth)
  @defineRequest({ path: UserIdPathDto })
  @doc
  async updateUser(req: Request) {
    return { statusCode: 200, headers: json, body: { updated: req.path?.id } };
  }

  @get('/admin', { appId })
  @accessControl([{ inputProperty: 'auth.user.role', expectedValue: 'admin', statusCode: 403, message: 'Admins only' }])
  @withAuth(bearerAuth)
  @doc
  async admin() {
    return { statusCode: 200, headers: json, body: { ok: true } };
  }

  @get('/even', { appId })
  @accessControl([
    {
      inputProperty: 'auth.user.id',
      accessControlHandler: async (id: unknown) => (id as number) % 2 === 0,
      statusCode: 403,
      message: 'Odd users denied',
    },
  ])
  @withAuth(bearerAuth)
  @doc
  async even() {
    return { statusCode: 200, headers: json, body: { ok: true } };
  }

  @get('/multi', { appId })
  @accessControl([
    { inputProperty: 'auth.user.role', expectedValue: 'user', statusCode: 403, message: 'Rule 1' },
    { inputProperty: 'auth.user.id', expectedValue: 2, statusCode: 451, message: 'Rule 2' },
  ])
  @withAuth(bearerAuth)
  @doc
  async multi() {
    return { statusCode: 200, headers: json, body: { ok: true } };
  }

  @get('/no-auth-acl', { appId })
  @accessControl([{ inputProperty: 'auth.user.id', expectedValue: 1, statusCode: 403, message: 'Denied' }])
  @doc
  async noAuthAcl() {
    return { statusCode: 200, headers: json, body: { ok: true } };
  }
}

let app: AladoServer;
let port: number;

before(async () => {
  app = initializeApplication({ serverOptions: baseOptions(appId), controllers: [AuthController] });
  port = await listen(app);
});

after(() => close(app));

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

describe('withAuth', () => {
  it('rejects a request with no credentials', async () => {
    const r = await send(port, { path: '/me' });
    assert.equal(r.status, 401);
    assert.deepEqual(r.json(), { message: 'Unauthorized' });
  });

  it('rejects credentials the handler does not accept', async () => {
    const r = await send(port, { path: '/me', headers: bearer('wrong') });
    assert.equal(r.status, 401);
  });

  it('injects the handler result at outputProperty', async () => {
    const r = await send(port, { path: '/me', headers: bearer('token-alice') });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json(), { user: { id: 1, role: 'user' } });
  });

  it('uses the configured status when the handler throws', async () => {
    const r = await send(port, { path: '/me', headers: bearer('explode') });
    assert.equal(r.status, 401);
  });

  it('does not leak the auth handler exception message', async () => {
    const r = await send(port, { path: '/me', headers: bearer('explode') });
    assert.equal(r.status, 401);
    assert.deepEqual(r.json(), { message: 'Unauthorized' });
  });

  it('calls the handler with handlerContext as `this`', async () => {
    assert.equal((await send(port, { path: '/service', headers: { authorization: 'Token abc' } })).status, 200);
    assert.equal((await send(port, { path: '/service', headers: bearer('token-alice') })).status, 401);
  });

  it(
    'lets anonymous requests through when required is false',
    { todo: 'BUG: with required:false the handler still runs and a falsy result returns the auth error' },
    async () => {
      const r = await send(port, { path: '/maybe' });
      assert.equal(r.status, 200);
    },
  );

  it('still authenticates when required is false and credentials are sent', async () => {
    const r = await send(port, { path: '/maybe', headers: bearer('token-bob') });
    assert.equal(r.status, 200);
    assert.equal(r.json().user.id, 2);
  });
});

describe('accessControl', () => {
  it('allows a user to act on their own resource', async () => {
    const r = await sendJson(port, 'PATCH', '/users/1', {}, bearer('token-alice'));
    assert.equal(r.status, 200);
    assert.deepEqual(r.json(), { updated: '1' });
  });

  it("forbids acting on someone else's resource", async () => {
    const r = await sendJson(port, 'PATCH', '/users/2', {}, bearer('token-alice'));
    assert.equal(r.status, 403);
    assert.deepEqual(r.json(), { message: 'Access Denied' });
  });

  it('runs authentication before access control', async () => {
    const r = await sendJson(port, 'PATCH', '/users/1', {});
    assert.equal(r.status, 401);
  });

  it('supports expectedValue', async () => {
    assert.equal((await send(port, { path: '/admin', headers: bearer('token-root') })).status, 200);
    const r = await send(port, { path: '/admin', headers: bearer('token-alice') });
    assert.equal(r.status, 403);
    assert.deepEqual(r.json(), { message: 'Admins only' });
  });

  it('supports accessControlHandler', async () => {
    assert.equal((await send(port, { path: '/even', headers: bearer('token-bob') })).status, 200);
    assert.equal((await send(port, { path: '/even', headers: bearer('token-alice') })).status, 403);
  });

  it('applies rules in order and returns the first failing rule', async () => {
    assert.equal((await send(port, { path: '/multi', headers: bearer('token-bob') })).status, 200);
    assert.equal((await send(port, { path: '/multi', headers: bearer('token-root') })).status, 403);
    const r = await send(port, { path: '/multi', headers: bearer('token-alice') });
    assert.equal(r.status, 451);
    assert.deepEqual(r.json(), { message: 'Rule 2' });
  });

  it('denies when the route has access rules but no auth populated req.auth', async () => {
    const r = await send(port, { path: '/no-auth-acl' });
    assert.equal(r.status, 403);
  });
});
