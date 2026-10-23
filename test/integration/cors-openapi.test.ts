import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  AladoServer,
  Request,
  RequestAuthentication,
  defineRequest,
  defineResponse,
  documentProperty,
  fileUploadProperty,
  get,
  initializeApplication,
  post,
  validateProperty,
  withAuth,
} from '../../src';
import { baseOptions, close, listen, multipart, send } from '../helpers/http';

const json = { 'Content-Type': 'application/json' };

// ---------- CORS app ----------

const corsId = 'cors';
const corsDoc = defineResponse({ statusCode: 200, headers: json, body: { ok: true } });

class CorsController {
  @get('/things', { appId: corsId })
  @corsDoc
  async list() {
    return { statusCode: 200, headers: json, body: [] as any };
  }

  @post('/things', { appId: corsId })
  @corsDoc
  async create() {
    return { statusCode: 201, headers: json, body: {} };
  }

  @get('/things/:id', { appId: corsId })
  @corsDoc
  async one() {
    return { statusCode: 200, headers: json, body: {} };
  }
}

// ---------- CORS disabled app ----------

const closedId = 'cors-off';

class ClosedController {
  @get('/private', { appId: closedId })
  @defineResponse({ statusCode: 200, headers: json, body: { ok: true } })
  async private() {
    return { statusCode: 200, headers: json, body: { ok: true } };
  }
}

// ---------- OpenAPI app ----------

const docsId = 'openapi';

const apiKeyAuth: RequestAuthentication = {
  inputProperty: 'headers.authorization',
  outputProperty: 'auth.user',
  required: true,
  handler: () => ({ id: 1 }),
  error: { statusCode: 401, message: 'Unauthorized' },
};

class CreateWidgetDto {
  @validateProperty({
    required: true,
    handler: (v: unknown) => typeof v === 'string',
    error: { statusCode: 400, message: 'name' },
  })
  @documentProperty({ schema: { type: 'string', minLength: 1 }, description: 'Widget name', example: 'gear' })
  name: string = 'gear';
}

class WidgetIdDto {
  @validateProperty({
    required: true,
    handler: (v: unknown) => typeof v === 'string',
    error: { statusCode: 400, message: 'id' },
  })
  @documentProperty({ schema: { type: 'string' }, description: 'Widget id' })
  id: string = '1';
}

class WidgetFilterDto {
  @validateProperty({ handler: (v: unknown) => typeof v === 'string', error: { statusCode: 400, message: 'color' } })
  @documentProperty({
    schema: {
      type: 'string',
      enum: [
        'red',
        'blue',
      ],
    },
  })
  color: string = 'red';
}

class WidgetFilesDto {
  @fileUploadProperty({
    mimetypes: ['image/png'],
    maxSize: 1024,
    required: true,
    requiredError: { statusCode: 400, message: 'image' },
    mimetypeError: { statusCode: 415, message: 'image' },
    maxSizeError: { statusCode: 413, message: 'image' },
  })
  image: any;
}

class DocsController {
  @post('/widgets', { appId: docsId, tags: ['Widget'], description: 'Create a widget' })
  @withAuth(apiKeyAuth)
  @defineRequest({ body: CreateWidgetDto })
  @defineResponse({ statusCode: 201, title: 'Widget', headers: json, body: { id: '1', name: 'gear' } })
  async create(req: Request) {
    return { statusCode: 201, headers: json, body: { id: '1', ...req.body } };
  }

  @get('/widgets/:id', { appId: docsId, tags: ['Widget'] })
  @defineRequest({ path: WidgetIdDto, query: WidgetFilterDto })
  @defineResponse({ statusCode: 200, title: 'WidgetOne', headers: json, body: { id: '1', name: 'gear' } })
  async one(req: Request) {
    return { statusCode: 200, headers: json, body: { id: req.path?.id, name: 'gear' } };
  }

  @get('/widgets', { appId: docsId, tags: ['Widget'] })
  @defineResponse({ statusCode: 200, entity: 'WidgetList', headers: json, body: [{ id: '1', name: 'gear' }] })
  async list() {
    return { statusCode: 200, headers: json, body: [] as any };
  }

  @post('/widgets/:id/image', { appId: docsId })
  @defineRequest({ path: WidgetIdDto, files: WidgetFilesDto })
  @defineResponse({ statusCode: 204 })
  async image() {
    return { statusCode: 204 };
  }

  @get('/internal/health', { appId: docsId, isHidden: true })
  @defineResponse({ statusCode: 200, headers: json, body: { ok: true } })
  async health() {
    return { statusCode: 200, headers: json, body: { ok: true } };
  }
}

let corsApp: AladoServer;
let closedApp: AladoServer;
let docsApp: AladoServer;
let corsPort: number;
let closedPort: number;
let docsPort: number;

before(async () => {
  corsApp = initializeApplication({
    serverOptions: baseOptions(corsId, {
      cors: {
        enable: true,
        allowedOrigin: [
          'https://app.example.com',
          'https://admin.example.com',
        ],
        allowedHeaders: [
          'authorization',
          'content-type',
        ],
        exposeHeaders: ['x-total-count'],
        allowedCredentials: true,
        maxAge: 600,
      },
    }),
    controllers: [CorsController],
  });
  closedApp = initializeApplication({ serverOptions: baseOptions(closedId), controllers: [ClosedController] });
  docsApp = initializeApplication({
    serverOptions: baseOptions(docsId, {
      openApiDoc: { enable: true, route: '/docs', info: { title: 'Widgets', version: '1.0.0' } },
    }),
    controllers: [DocsController],
  });
  corsPort = await listen(corsApp);
  closedPort = await listen(closedApp);
  docsPort = await listen(docsApp);
});

after(async () => {
  await close(corsApp);
  await close(closedApp);
  await close(docsApp);
});

describe('CORS', () => {
  it('answers a preflight with 204 and the configured headers', async () => {
    const r = await send(corsPort, {
      method: 'OPTIONS',
      path: '/things',
      headers: { Origin: 'https://app.example.com', 'Access-Control-Request-Method': 'POST' },
    });
    assert.equal(r.status, 204);
    assert.equal(r.headers['access-control-allow-origin'], 'https://app.example.com');
    assert.equal(r.headers['access-control-allow-headers'], 'authorization, content-type');
    assert.equal(r.headers['access-control-expose-headers'], 'x-total-count');
    assert.equal(r.headers['access-control-allow-credentials'], 'true');
    assert.equal(r.headers['access-control-max-age'], '600');
  });

  it('lists every method registered on the path in the preflight', async () => {
    const r = await send(corsPort, {
      method: 'OPTIONS',
      path: '/things',
      headers: { Origin: 'https://app.example.com' },
    });
    const methods = (r.headers['access-control-allow-methods'] as string).split(', ').sort();
    assert.deepEqual(methods, [
      'GET',
      'OPTIONS',
      'POST',
    ]);
  });

  it('builds preflight routes for parameterised paths', async () => {
    const r = await send(corsPort, {
      method: 'OPTIONS',
      path: '/things/42',
      headers: { Origin: 'https://app.example.com' },
    });
    assert.equal(r.status, 204);
    assert.deepEqual((r.headers['access-control-allow-methods'] as string).split(', ').sort(), [
      'GET',
      'OPTIONS',
    ]);
  });

  it('echoes an allowed origin on actual requests', async () => {
    const r = await send(corsPort, { path: '/things', headers: { Origin: 'https://admin.example.com' } });
    assert.equal(r.status, 200);
    assert.equal(r.headers['access-control-allow-origin'], 'https://admin.example.com');
    assert.equal(r.headers['access-control-allow-credentials'], 'true');
  });

  it('omits Allow-Origin for an origin that is not on the list', async () => {
    const pre = await send(corsPort, {
      method: 'OPTIONS',
      path: '/things',
      headers: { Origin: 'https://evil.example' },
    });
    assert.equal(pre.headers['access-control-allow-origin'], undefined);
    const r = await send(corsPort, { path: '/things', headers: { Origin: 'https://evil.example' } });
    assert.equal(r.headers['access-control-allow-origin'], undefined);
  });

  it('sends no CORS headers when CORS is disabled', async () => {
    const r = await send(closedPort, { path: '/private', headers: { Origin: 'https://evil.example' } });
    assert.equal(r.status, 200);
    assert.equal(r.headers['access-control-allow-origin'], undefined);
  });

  it('sends no CORS headers on a 404 when CORS is disabled', async () => {
    const r = await send(closedPort, { path: '/nope', headers: { Origin: 'https://evil.example' } });
    assert.equal(r.status, 404);
    assert.equal(r.headers['access-control-allow-origin'], undefined);
  });

  it('does not answer preflights when CORS is disabled', async () => {
    const r = await send(closedPort, {
      method: 'OPTIONS',
      path: '/private',
      headers: { Origin: 'https://evil.example' },
    });
    assert.equal(r.status, 404);
    assert.equal(r.headers['access-control-allow-origin'], undefined);
  });
});

describe('OpenAPI', () => {
  let spec: any;

  before(async () => {
    const r = await send(docsPort, { path: '/swagger.json' });
    assert.equal(r.status, 200);
    spec = r.json();
  });

  it('serves an OpenAPI 3 document with the configured info', () => {
    assert.match(spec.openapi, /^3\./);
    assert.deepEqual(spec.info, { title: 'Widgets', version: '1.0.0' });
  });

  it('converts :params to {params} in paths', () => {
    assert.ok(spec.paths['/widgets/{id}'], Object.keys(spec.paths).join(', '));
    assert.equal(spec.paths['/widgets/:id'], undefined);
  });

  it('documents path and query parameters from DTOs', () => {
    const params = spec.paths['/widgets/{id}'].get.parameters;
    const id = params.find((p: any) => p.in === 'path' && p.name === 'id');
    const color = params.find((p: any) => p.in === 'query' && p.name === 'color');
    assert.equal(id.required, true);
    assert.equal(id.description, 'Widget id');
    assert.deepEqual(color.schema, {
      type: 'string',
      enum: [
        'red',
        'blue',
      ],
    });
    assert.equal(color.required, false);
  });

  it('documents a JSON request body', () => {
    const body = spec.paths['/widgets'].post.requestBody.content['application/json'].schema;
    assert.deepEqual(body.properties.name, { type: 'string', minLength: 1 });
  });

  it('documents uploads as multipart/form-data binary fields', () => {
    const schema = spec.paths['/widgets/{id}/image'].post.requestBody.content['multipart/form-data'].schema;
    assert.deepEqual(schema.properties.image, { type: 'string', format: 'binary' });
  });

  it('registers an apiKey security scheme for withAuth routes', () => {
    assert.deepEqual(spec.paths['/widgets'].post.security, [{ headersAuthorization: [] }]);
    assert.deepEqual(spec.components.securitySchemes.headersAuthorization, {
      type: 'apiKey',
      in: 'header',
      name: 'authorization',
    });
  });

  it('documents responses with component schemas', () => {
    const res = spec.paths['/widgets'].post.responses['201'];
    assert.equal(res.content['application/json'].schema.$ref, '#/components/schemas/Widget');
    assert.ok(spec.components.schemas.Widget.properties.name);
  });

  it('documents array responses as items of a named entity', () => {
    const schema = spec.paths['/widgets'].get.responses['200'].content['application/json'].schema;
    assert.equal(schema.type, 'array');
    assert.equal(schema.items.$ref, '#/components/schemas/WidgetList');
  });

  it('carries tags and description from the method decorator', () => {
    assert.deepEqual(spec.paths['/widgets'].post.tags, ['Widget']);
    assert.equal(spec.paths['/widgets'].post.description, 'Create a widget');
  });

  it('excludes routes marked isHidden', () => {
    assert.equal(spec.paths['/internal/health'], undefined);
  });

  it('still serves hidden routes', async () => {
    assert.equal((await send(docsPort, { path: '/internal/health' })).status, 200);
  });

  it('uses "header" (not "headers") for header parameters', () => {
    for (const path of Object.values<any>(spec.paths)) {
      for (const op of Object.values<any>(path)) {
        for (const p of op.parameters || []) {
          assert.notEqual(p.in, 'headers');
        }
      }
    }
    // forces the case: there is no header DTO in this app, so re-check the factory directly
    const { openApiDocFactory } = require('../../src/factory');
    const doc: any = { paths: {}, components: { schemas: {}, securitySchemes: {} } };
    openApiDocFactory(
      'get',
      '/h',
      {
        title: 't',
        options: { openApiDoc: {} },
        request: {
          headers: { 'x-tenant': { validation: { required: true }, openApiDoc: { schema: { type: 'string' } } } },
        },
        response: { statusCode: 204 },
      },
      doc,
    );
    assert.equal(doc.paths['/h'].get.parameters[0].in, 'header');
  });

  it('serves Swagger UI at the docs route', async () => {
    const r = await send(docsPort, { path: '/docs' });
    assert.equal(r.status, 200);
    assert.match(r.text, /swagger-ui/i);
  });

  it('points the Swagger UI initializer at /swagger.json', async () => {
    const r = await send(docsPort, { path: '/swagger-initializer.js' });
    assert.equal(r.status, 200);
    assert.match(r.text, /\/swagger\.json/);
    assert.doesNotMatch(r.text, /petstore/);
  });

  it('returns 404 for unknown files under the docs route', async () => {
    assert.equal((await send(docsPort, { path: '/docs/nope.js' })).status, 404);
  });

  for (const path of [
    '/docs/../../../../../../../../../../etc/passwd',
    '/docs/../../../../../../../../../../etc/passwd?x=1',
    '/docs/..%2f..%2f..%2f..%2f..%2f..%2f..%2f..%2fetc%2fpasswd',
    '/docs/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd',
    '/docs/..\\..\\..\\..\\..\\..\\etc\\passwd',
    '/../../../../../../../../../../etc/passwd',
    '/docs//etc/passwd',
    '/docs/../package.json',
    '/docs/../../alado/package.json',
  ]) {
    it(`does not serve files outside the Swagger UI directory: ${path}`, async () => {
      const r = await send(docsPort, { path });
      assert.doesNotMatch(r.text, /root:/);
      assert.doesNotMatch(r.text, /"name":\s*"alado"/);
      assert.equal(r.status, 404, `${path} -> ${r.status}`);
    });
  }

  it('serves Swagger UI assets from the docs route and from the root', async () => {
    for (const path of [
      '/docs/swagger-ui.css',
      '/swagger-ui.css',
      '/docs/swagger-ui-bundle.js',
    ]) {
      assert.equal((await send(docsPort, { path })).status, 200, path);
    }
  });

  it('does not treat a route that only shares the prefix as the docs route', async () => {
    assert.equal((await send(docsPort, { path: '/docsswagger-ui.css' })).status, 404);
  });

  it('patches the initializer under the docs route too', async () => {
    const r = await send(docsPort, { path: '/docs/swagger-initializer.js' });
    assert.equal(r.status, 200);
    assert.match(r.text, /\/swagger\.json/);
    assert.doesNotMatch(r.text, /petstore/);
    assert.match(r.headers['content-type'] as string, /javascript/);
  });

  it('refuses to register a GET route on the docs path', () => {
    assert.throws(() =>
      docsApp.get(
        '/docs',
        { title: 'x', options: { allowUnknownFields: false }, request: {}, response: { statusCode: 204 } } as any,
        () => ({
          statusCode: 204,
        }),
      ),
    );
  });
});

describe('OpenAPI + multipart smoke', () => {
  it('a documented upload route still accepts real uploads', async () => {
    const { body, contentType } = multipart([
      {
        name: 'image',
        filename: 'a.png',
        contentType: 'image/png',
        value: Buffer.from([
          1,
          2,
          3,
        ]),
      },
    ]);
    const r = await send(docsPort, {
      method: 'POST',
      path: '/widgets/1/image',
      headers: { 'Content-Type': contentType },
      body,
    });
    assert.equal(r.status, 204);
  });
});
