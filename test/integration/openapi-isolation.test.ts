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

describe('OpenAPI path parameters', () => {
  const app = new AladoServer(baseOptions('openapi-path-params', { openApiDoc: { ...docs } }));
  let port: number;

  before(async () => {
    app.get(
      '/users/:userId/posts/:postId',
      {
        ...context('posts'),
        request: {
          path: {
            userId: {
              validation: { handler: () => true, error: { statusCode: 400, message: 'bad' } },
              openApiDoc: { schema: { type: 'integer' }, description: 'user' },
            },
          },
        },
      },
      async () => ({ statusCode: 200, body: { ok: true } }),
    );
    port = await listen(app);
  });

  after(() => close(app));

  it('declares every path parameter as required, documented or not', async () => {
    const doc = (await send(port, { path: '/swagger.json' })).json();
    const parameters = doc.paths['/users/{userId}/posts/{postId}'].get.parameters;
    assert.deepEqual(parameters, [
      { in: 'path', name: 'userId', required: true, schema: { type: 'integer' }, description: 'user' },
      { in: 'path', name: 'postId', required: true, schema: { type: 'string' } },
    ]);
  });
});

describe('OpenAPI document of a route without request or options', () => {
  const app = new AladoServer(baseOptions('openapi-minimal-context', { openApiDoc: { ...docs } }));
  let port: number;

  before(async () => {
    app.get('/minimal', { title: 'minimal', response: { statusCode: 200, body: { ok: true } } } as any, async () => ({
      statusCode: 200,
      body: { ok: true },
    }));
    port = await listen(app);
  });

  after(() => close(app));

  it('registers and serves the route', async () => {
    assert.equal((await send(port, { path: '/minimal' })).status, 200);
  });

  it('documents the route', async () => {
    const doc = (await send(port, { path: '/swagger.json' })).json();
    assert.deepEqual(Object.keys(doc.paths), ['/minimal']);
    assert.deepEqual(doc.paths['/minimal'].get.parameters, []);
  });
});
