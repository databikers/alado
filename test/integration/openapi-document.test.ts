import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer, validate } from '../../src';
import { baseOptions } from '../helpers/http';

const field = (required: boolean) => ({
  validation: { required, handler: validate.string().build(), error: { statusCode: 400, message: 'bad' } },
  openApiDoc: { schema: { type: 'string' } },
});
const auth = (inputProperty: string, required?: boolean) => ({
  inputProperty,
  outputProperty: 'auth',
  required,
  handler: async () => ({}),
  error: { statusCode: 401, message: 'no' },
});
const json = { 'Content-Type': 'application/json' };
const ok = async () => ({ statusCode: 200 });

function documentOf(register: (app: AladoServer) => void): any {
  const app = new AladoServer(
    baseOptions('openapi-document', {
      openApiDoc: { enable: true, route: '/docs', info: { title: 't', version: '1' } },
    }),
  );
  register(app);
  return (app as any).router.openApiDocObject;
}

const route = (extra: Record<string, unknown>): any => ({
  title: 't',
  options: { allowUnknownFields: false },
  request: {},
  ...extra,
});

describe('OpenAPI document', () => {
  it('gives every route its own response schema unless it names an entity', () => {
    const doc = documentOf((app) => {
      const response = (body: object, extra = {}) => ({
        response: { statusCode: 200, title: 'OK', headers: json, body, ...extra },
      });
      app.get('/users/:id', route(response({ name: 'a' })), ok);
      app.get('/orders/:id', route(response({ total: 1 })), ok);
      app.get('/plain', route({ response: { statusCode: 200, headers: json, body: { x: 1 } } }), ok);
      app.get('/a/users', route(response({ id: 'u' }, { entity: 'User' })), ok);
      app.get('/b/users', route(response({ id: 'u' }, { entity: 'User' })), ok);
    });
    const ref = (path: string) => doc.paths[path].get.responses['200'].content['application/json'].schema.$ref;
    assert.equal(ref('/users/{id}'), '#/components/schemas/GetUsersById200');
    assert.equal(ref('/orders/{id}'), '#/components/schemas/GetOrdersById200');
    assert.equal(ref('/plain'), '#/components/schemas/GetPlain200');
    assert.ok(doc.components.schemas.GetUsersById200.properties.name);
    assert.ok(doc.components.schemas.GetOrdersById200.properties.total);
    assert.equal(ref('/a/users'), '#/components/schemas/User');
    assert.equal(ref('/b/users'), '#/components/schemas/User');
    assert.equal(doc.components.schemas.undefined, undefined);
  });

  it('describes the body for a Content-Type with parameters, and JSON without one', () => {
    const doc = documentOf((app) => {
      app.post(
        '/charset',
        route({
          response: {
            statusCode: 201,
            headers: { 'content-type': 'application/json; charset=utf-8' },
            body: { id: 'x' },
          },
        }),
        ok,
      );
      app.get('/untyped', route({ response: { statusCode: 200, body: { id: 'x' } } }), ok);
    });
    const charset = doc.paths['/charset'].post.responses['201'];
    assert.deepEqual(Object.keys(charset.content), ['application/json; charset=utf-8']);
    assert.deepEqual(doc.components.schemas.PostCharset201.properties.id, { type: 'string' });
    const untyped = doc.paths['/untyped'].get.responses['200'];
    assert.deepEqual(Object.keys(untyped.content), ['application/json']);
  });

  it('gives a 204 no content and every response a description', () => {
    const doc = documentOf((app) => {
      app.delete('/items/:id', route({ response: { statusCode: 204 } }), ok);
      app.get(
        '/described',
        route({ response: { statusCode: 200, description: 'The item', headers: json, body: { a: 1 } } }),
        ok,
      );
    });
    assert.deepEqual(doc.paths['/items/{id}'].delete.responses, { 204: { description: '204 response' } });
    assert.equal(doc.paths['/described'].get.responses['200'].description, 'The item');
  });

  it('lists the required body fields', () => {
    const doc = documentOf((app) => {
      app.post(
        '/json',
        route({ request: { body: { name: field(true), nick: field(false) } }, response: { statusCode: 204 } }),
        ok,
      );
      app.post('/optional', route({ request: { body: { nick: field(false) } }, response: { statusCode: 204 } }), ok);
      app.post(
        '/upload',
        route({
          request: {
            body: { caption: field(true) },
            files: {
              doc: {
                mimetypes: ['text/plain'],
                maxSize: 10,
                required: true,
                requiredError: { statusCode: 400, message: 'r' },
                mimetypeError: { statusCode: 415, message: 't' },
                maxSizeError: { statusCode: 413, message: 's' },
              },
            },
          },
          response: { statusCode: 204 },
        }),
        ok,
      );
    });
    const json = doc.paths['/json'].post.requestBody;
    assert.equal(json.required, true);
    assert.deepEqual(json.content['application/json'].schema.required, ['name']);
    const optional = doc.paths['/optional'].post.requestBody;
    assert.equal(optional.required, undefined);
    assert.equal(optional.content['application/json'].schema.required, undefined);
    const upload = doc.paths['/upload'].post.requestBody;
    assert.equal(upload.required, true);
    assert.deepEqual(upload.content['multipart/form-data'].schema.required, [
      'doc',
      'caption',
    ]);
  });

  it('publishes header and query credentials only, optional auth as optional', () => {
    const doc = documentOf((app) => {
      const response = { response: { statusCode: 204 } };
      app.get('/key', route({ ...response, auth: auth('headers.X-Api-Key') }), ok);
      app.get('/maybe', route({ ...response, auth: auth('query.token', false) }), ok);
      app.post(
        '/login',
        route({ ...response, request: { body: { token: field(true) } }, auth: auth('body.token') }),
        ok,
      );
    });
    const schemes = doc.components.securitySchemes;
    assert.deepEqual(doc.paths['/key'].get.security, [{ 'headersX-Api-Key': [] }]);
    assert.deepEqual(schemes['headersX-Api-Key'], { type: 'apiKey', in: 'header', name: 'x-api-key' });
    assert.deepEqual(doc.paths['/maybe'].get.security, [
      { queryToken: [] },
      {},
    ]);
    assert.deepEqual(schemes.queryToken, { type: 'apiKey', in: 'query', name: 'token' });
    assert.equal(doc.paths['/login'].post.security, undefined);
    assert.ok(Object.values<any>(schemes).every((s) => s.in === 'header' || s.in === 'query'));
  });
});
