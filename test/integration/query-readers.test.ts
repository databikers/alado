import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer, Request, accessControl, defineResponse, get, initializeApplication, withAuth } from '../../src';
import { baseOptions, close, listen, send } from '../helpers/http';

const appId = 'query-readers';
const json = { 'Content-Type': 'application/json' };
const doc = defineResponse({ statusCode: 200, headers: json, body: {} });
const users: Record<string, { id: string; orgId: string }> = { 'token-a': { id: 'alice', orgId: 'o1' } };

const queryTokenAuth = withAuth({
  inputProperty: 'query.token',
  outputProperty: 'auth',
  required: true,
  handler: (token: string) => users[token] || null,
  error: { statusCode: 401, message: 'Unauthorized' },
});

const bearerAuth = withAuth({
  inputProperty: 'headers.authorization',
  outputProperty: 'auth',
  required: true,
  handler: (token: string) => users[token] || null,
  error: { statusCode: 401, message: 'Unauthorized' },
});

class QueryController {
  // no query DTO: the query string is only read by auth
  @get('/me', { appId })
  @queryTokenAuth
  @doc
  async me(req: Request) {
    return { statusCode: 200, headers: json, body: { auth: req.auth, query: req.query } };
  }

  // no query DTO: the query string is only read by access control
  @get('/org', { appId })
  @accessControl([
    { inputProperty: 'query.orgId', compareWithProperty: 'auth.orgId', statusCode: 403, message: 'Forbidden' },
  ])
  @bearerAuth
  @doc
  async org() {
    return { statusCode: 200, headers: json, body: { ok: true } };
  }

  @get('/plain', { appId })
  @doc
  async plain(req: Request) {
    return { statusCode: 200, headers: json, body: { query: req.query } };
  }
}

let app: AladoServer;
let port: number;

before(async () => {
  app = initializeApplication({ serverOptions: baseOptions(appId), controllers: [QueryController] });
  port = await listen(app);
});

after(() => close(app));

describe('query string read by auth and access control', () => {
  it('authenticates with a token from the query string on a route without a query DTO', async () => {
    const r = await send(port, { path: '/me?token=token-a' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json().auth, { id: 'alice', orgId: 'o1' });
    // undeclared query fields are still not handed to the handler
    assert.deepEqual(r.json().query, {});
    assert.equal((await send(port, { path: '/me?token=nope' })).status, 401);
  });

  it('compares a query value in access control on a route without a query DTO', async () => {
    const own = await send(port, { path: '/org?orgId=o1', headers: { authorization: 'token-a' } });
    const other = await send(port, { path: '/org?orgId=o2', headers: { authorization: 'token-a' } });
    const none = await send(port, { path: '/org', headers: { authorization: 'token-a' } });
    assert.equal(own.status, 200);
    assert.equal(other.status, 403);
    assert.equal(none.status, 403);
  });

  it('still skips parsing for routes that read no query', async () => {
    // malformed escapes would be a 400 if this query were parsed
    const r = await send(port, { path: '/plain?bad=%E0%A4%A' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json().query, {});
  });
});
