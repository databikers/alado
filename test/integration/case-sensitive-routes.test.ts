import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer, defineResponse, get, initializeApplication } from '../../src';
import { Router } from '../../src/router';
import { HttpMethod } from '../../src/constants';
import { baseOptions, close, listen, send } from '../helpers/http';

const json = { 'Content-Type': 'application/json' };
const doc = defineResponse({ statusCode: 200, headers: json, body: { ok: true } });

class StrictController {
  @get('/admin', { appId: 'routes-strict' })
  @doc
  async admin() {
    return { statusCode: 200, headers: json, body: { ok: true } };
  }

  @get('/users/:id/Profile', { appId: 'routes-strict' })
  @doc
  async profile() {
    return { statusCode: 200, headers: json, body: { ok: true } };
  }
}

class LooseController {
  @get('/admin', { appId: 'routes-loose' })
  @doc
  async admin() {
    return { statusCode: 200, headers: json, body: { ok: true } };
  }
}

let strict: AladoServer;
let loose: AladoServer;
let strictPort: number;
let loosePort: number;

before(async () => {
  strict = initializeApplication({ serverOptions: baseOptions('routes-strict'), controllers: [StrictController] });
  loose = initializeApplication({
    serverOptions: baseOptions('routes-loose', { caseSensitiveRoutes: false }),
    controllers: [LooseController],
  });
  strictPort = await listen(strict);
  loosePort = await listen(loose);
});

after(async () => {
  await close(strict);
  await close(loose);
});

describe('route case sensitivity', () => {
  it('is case-sensitive by default, so /ADMIN cannot slip past a proxy rule for /admin', async () => {
    assert.equal((await send(strictPort, { path: '/admin' })).status, 200);
    assert.equal((await send(strictPort, { path: '/ADMIN' })).status, 404);
    assert.equal((await send(strictPort, { path: '/Admin/' })).status, 404);
  });

  it('applies to routes with params too', async () => {
    assert.equal((await send(strictPort, { path: '/users/42/Profile' })).status, 200);
    assert.equal((await send(strictPort, { path: '/users/42/profile' })).status, 404);
  });

  it('can be relaxed with caseSensitiveRoutes: false', async () => {
    assert.equal((await send(loosePort, { path: '/ADMIN' })).status, 200);
    assert.equal((await send(loosePort, { path: '/Admin/' })).status, 200);
  });

  it('keeps CORS preflight routes in the same mode', () => {
    const ctx = {
      title: 't',
      options: { allowUnknownFields: false },
      request: {},
      response: { statusCode: 204 },
    } as any;
    const r = new Router(
      { cors: { enable: true, allowedMethods: new Map() }, openApiDoc: undefined, logger: { log() {} } } as any,
      {},
    );
    r.use(HttpMethod.GET, '/Items/:id', ctx, () => ({ statusCode: 204 }));
    assert.ok(r.parse(HttpMethod.OPTIONS, '/Items/1'));
    assert.equal(r.parse(HttpMethod.OPTIONS, '/items/1'), undefined);
  });

  it('rejects a non-boolean caseSensitiveRoutes', () => {
    assert.throws(
      () => new AladoServer(baseOptions('routes-invalid', { caseSensitiveRoutes: 'no' }) as any),
      /caseSensitiveRoutes should be a boolean/,
    );
  });
});
