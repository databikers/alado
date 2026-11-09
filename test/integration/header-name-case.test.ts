import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoConfigurationError, AladoServer, RequestAuthentication, validate } from '../../src';
import { baseOptions, close, listen, send } from '../helpers/http';

const bad = { statusCode: 400, message: 'bad key' };
const context = (extra: any) =>
  ({
    title: 't',
    options: { allowUnknownFields: false },
    response: { statusCode: 200, body: { ok: true } },
    ...extra,
  }) as any;

describe('header names declared with capitals', () => {
  const app = new AladoServer(
    baseOptions('header-name-case', { openApiDoc: { enable: true, route: '/docs', info: { title: 't' } } }),
  );
  const auth: RequestAuthentication = {
    inputProperty: 'headers.X-Api-Key',
    outputProperty: 'auth.user',
    required: true,
    handler: async (key: string) => (key === 'secret' ? { id: 1 } : null),
    error: { statusCode: 401, message: 'Unauthorized' },
  };
  let port: number;

  before(async () => {
    const echo = async (req: any) => ({ statusCode: 200, body: { key: req.headers['x-api-key'] ?? null } });
    app.get(
      '/required',
      context({
        request: {
          headers: {
            'X-Api-Key': { validation: { required: true, handler: validate.string().min(4).buildSync(), error: bad } },
          },
        },
      }),
      echo,
    );
    app.get(
      '/optional',
      context({
        request: {
          headers: {
            'X-Api-Key': {
              validation: {
                handler: validate
                  .string()
                  .regex(/^[a-z]+$/)
                  .buildSync(),
                error: bad,
              },
            },
          },
        },
      }),
      echo,
    );
    app.get('/auth', context({ request: {}, auth }), echo);
    app.get('/auth-again', context({ request: {}, auth }), echo);
    app.get(
      '/rule',
      context({
        request: {},
        accessControl: [
          { inputProperty: 'headers.X-Tenant', expectedValue: 'acme', statusCode: 403, message: 'Forbidden' },
        ],
      }),
      echo,
    );
    port = await listen(app);
  });

  after(() => close(app));

  it('validate the header a client sends, whatever its case', async () => {
    assert.equal((await send(port, { path: '/required', headers: { 'X-Api-Key': 'abcdef' } })).status, 200);
    assert.equal((await send(port, { path: '/required', headers: { 'x-api-key': 'abc' } })).status, 400);
    assert.equal((await send(port, { path: '/required' })).status, 400);
  });

  it('never let an optional header through unvalidated', async () => {
    assert.equal((await send(port, { path: '/optional' })).status, 200);
    assert.equal((await send(port, { path: '/optional', headers: { 'X-Api-Key': 'abc' } })).status, 200);
    assert.deepEqual((await send(port, { path: '/optional', headers: { 'X-Api-Key': 'A-B-C' } })).json(), {
      message: 'bad key',
    });
  });

  it('are found by auth and access-control rules', async () => {
    assert.equal((await send(port, { path: '/auth', headers: { 'X-Api-Key': 'secret' } })).status, 200);
    assert.equal((await send(port, { path: '/auth-again', headers: { 'X-Api-Key': 'secret' } })).status, 200);
    assert.equal((await send(port, { path: '/auth', headers: { 'X-Api-Key': 'nope' } })).status, 401);
    assert.equal((await send(port, { path: '/rule', headers: { 'X-Tenant': 'acme' } })).status, 200);
    assert.equal((await send(port, { path: '/rule', headers: { 'X-Tenant': 'other' } })).status, 403);
  });

  it('leave the shared auth config and the OpenAPI spelling as declared', async () => {
    assert.equal(auth.inputProperty, 'headers.X-Api-Key');
    const doc = (await send(port, { path: '/docs/swagger.json' })).json();
    const names = doc.paths['/required'].get.parameters.filter((p: any) => p.in === 'header').map((p: any) => p.name);
    assert.deepEqual(names, ['X-Api-Key']);
  });

  it('refuse a header declared twice in different cases', () => {
    const other = new AladoServer(baseOptions('header-name-case-twice'));
    const definition = { validation: { handler: () => true, error: bad } };
    assert.throws(
      () =>
        other.get(
          '/twice',
          context({ request: { headers: { 'X-Api-Key': definition, 'x-api-key': definition } } }),
          async () => ({ statusCode: 200, body: {} }),
        ),
      (e: any) => e instanceof AladoConfigurationError && e.code === 'HEADER_DECLARED_TWICE',
    );
  });
});
