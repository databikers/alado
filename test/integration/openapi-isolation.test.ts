import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer } from '../../src';
import { baseOptions, close, listen, send } from '../helpers/http';

const context = (title: string) =>
  ({
    title,
    request: {},
    options: { allowUnknownFields: false },
    response: { statusCode: 200, body: { ok: true } },
  }) as any;

const docs = { enable: true, route: '/docs', info: { title: 'docs' } };

describe('OpenAPI document of separate servers', () => {
  const publicApp = new AladoServer(baseOptions('openapi-isolation-public', { openApiDoc: { ...docs } }));
  const adminApp = new AladoServer(baseOptions('openapi-isolation-admin', { openApiDoc: { ...docs } }));
  let publicPort: number;
  let adminPort: number;

  before(async () => {
    publicApp.get('/hello', context('hello'), async () => ({ statusCode: 200, body: { ok: true } }));
    adminApp.post('/internal/users', context('users'), async () => ({ statusCode: 200, body: { ok: true } }));
    publicPort = await listen(publicApp);
    adminPort = await listen(adminApp);
  });

  after(async () => {
    await close(publicApp);
    await close(adminApp);
  });

  it('lists only the routes of its own server', async () => {
    const publicDoc = (await send(publicPort, { path: '/swagger.json' })).json();
    const adminDoc = (await send(adminPort, { path: '/swagger.json' })).json();
    assert.deepEqual(Object.keys(publicDoc.paths), ['/hello']);
    assert.deepEqual(Object.keys(adminDoc.paths), ['/internal/users']);
  });

  it('does not change the shared default document', async () => {
    const { defaultOpenApiDocObject } = await import('../../src/constants');
    assert.deepEqual(defaultOpenApiDocObject.paths, {});
  });
});
