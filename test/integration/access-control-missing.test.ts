import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer, accessControl, defineResponse, get, initializeApplication, withAuth } from '../../src';
import { baseOptions, close, listen, send } from '../helpers/http';

const appId = 'access-control-missing';
const json = { 'Content-Type': 'application/json' };
const doc = defineResponse({ statusCode: 200, headers: json, body: { ok: true } });
const users: Record<string, { id?: string; tenantId?: string }> = {
  'token-a': { id: 'alice', tenantId: 't1' },
  'token-no-tenant': { id: 'bob' },
};

// auth is optional: anonymous requests reach the access-control step with auth = null
const optionalAuth = withAuth({
  inputProperty: 'headers.authorization',
  outputProperty: 'auth',
  required: false,
  handler: (token: string) => users[token] || null,
  error: { statusCode: 401, message: 'Unauthorized' },
});

class TenantController {
  @get('/orders', { appId })
  @accessControl([
    {
      inputProperty: 'headers.x-tenant-id',
      compareWithProperty: 'auth.tenantId',
      statusCode: 403,
      message: 'Forbidden',
    },
  ])
  @optionalAuth
  @doc
  async orders() {
    return { statusCode: 200, headers: json, body: { ok: true } };
  }

  @get('/users/:id', { appId })
  @accessControl([
    {
      inputProperty: 'auth.id',
      transformInputProperty: (v: unknown) => String(v),
      compareWithProperty: 'path.id',
      statusCode: 403,
      message: 'Forbidden',
    },
  ])
  @optionalAuth
  @doc
  async user() {
    return { statusCode: 200, headers: json, body: { ok: true } };
  }
}

let app: AladoServer;
let port: number;

before(async () => {
  app = initializeApplication({ serverOptions: baseOptions(appId), controllers: [TenantController] });
  port = await listen(app);
});

after(() => close(app));

describe('access control with missing values', () => {
  it('denies an anonymous request when both compared values are missing', async () => {
    const r = await send(port, { path: '/orders' });
    assert.equal(r.status, 403);
  });

  it('denies a user whose token has no tenant and who sends no tenant header', async () => {
    const r = await send(port, { path: '/orders', headers: { authorization: 'token-no-tenant' } });
    assert.equal(r.status, 403);
  });

  it('still allows a matching tenant and denies a different one', async () => {
    const ok = await send(port, { path: '/orders', headers: { authorization: 'token-a', 'x-tenant-id': 't1' } });
    const other = await send(port, { path: '/orders', headers: { authorization: 'token-a', 'x-tenant-id': 't2' } });
    assert.equal(ok.status, 200);
    assert.equal(other.status, 403);
  });

  it('does not let a transform turn a missing value into a match', async () => {
    // String(undefined) === 'undefined' === path.id
    const r = await send(port, { path: '/users/undefined' });
    assert.equal(r.status, 403);
    const own = await send(port, { path: '/users/alice', headers: { authorization: 'token-a' } });
    assert.equal(own.status, 200);
  });
});
