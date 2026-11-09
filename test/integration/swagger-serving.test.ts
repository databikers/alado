import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoConfigurationError, AladoServer, defineResponse, get, initializeApplication } from '../../src';
import { resolveSwaggerUiFile, swaggerIndexHtml } from '../../src/request-processor/request-processor';
import { baseOptions, close, listen, send } from '../helpers/http';

const appId = 'swagger-serving';
const json = { 'Content-Type': 'application/json' };

class PagesController {
  @get('/index.html', { appId })
  @defineResponse({ statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: '<p>app</p>' })
  async page() {
    return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: '<p>app</p>' };
  }

  @get('/swagger.json', { appId })
  @defineResponse({ statusCode: 200, headers: json, body: { route: 'root' } })
  async rootSwaggerJson() {
    return { statusCode: 200, headers: json, body: { route: 'root' } };
  }

  @get('/docs/guide', { appId })
  @defineResponse({ statusCode: 200, headers: json, body: { route: 'guide' } })
  async guide() {
    return { statusCode: 200, headers: json, body: { route: 'guide' } };
  }

  @get('/docs/swagger.jsonx', { appId })
  @defineResponse({ statusCode: 200, headers: json, body: { route: 'api' } })
  async notTheDocs() {
    return { statusCode: 200, headers: json, body: { route: 'api' } };
  }
}

let app: AladoServer;
let port: number;

before(async () => {
  app = initializeApplication({
    serverOptions: baseOptions(appId, {
      openApiDoc: { enable: true, route: '/docs', info: { title: 'Docs', version: '1.0.0' } },
    }),
    controllers: [PagesController],
  });
  port = await listen(app);
});

after(() => close(app));

describe('Swagger UI serving', () => {
  it('serves the docs page with a <base> under the docs route, with or without a trailing slash', async () => {
    for (const path of [
      '/docs',
      '/docs/',
    ]) {
      const r = await send(port, { path });
      assert.equal(r.status, 200, path);
      assert.match(r.headers['content-type'] as string, /text\/html/);
      assert.match(r.text, /<base href="\/docs\/" \/>/);
    }
  });

  it('does not serve Swagger UI files from the root', async () => {
    for (const path of [
      '/swagger-ui.css',
      '/swagger-ui-bundle.js',
      '/swagger-initializer.js',
    ]) {
      assert.equal((await send(port, { path })).status, 404, path);
    }
  });

  it('lets API routes use names that Swagger UI files have', async () => {
    const r = await send(port, { path: '/index.html' });
    assert.equal(r.status, 200);
    assert.equal(r.text, '<p>app</p>');
  });

  it('serves the OpenAPI document under the docs route, matched exactly', async () => {
    const r = await send(port, { path: '/docs/swagger.json' });
    assert.equal(r.status, 200);
    assert.equal(r.json().openapi, '3.0.0');
    assert.equal((await send(port, { path: '/docs/swagger.json?v=2' })).status, 200);
    assert.deepEqual((await send(port, { path: '/docs/swagger.jsonx' })).json(), { route: 'api' });
  });

  it('leaves /swagger.json and other paths under the docs route to the API', async () => {
    assert.deepEqual((await send(port, { path: '/swagger.json' })).json(), { route: 'root' });
    assert.deepEqual((await send(port, { path: '/docs/guide' })).json(), { route: 'guide' });
  });

  it('points Swagger UI at the document under the docs route', async () => {
    const r = await send(port, { path: '/docs/swagger-initializer.js' });
    assert.match(r.text, /url: "\/docs\/swagger\.json"/);
  });

  it('refuses GET routes that the docs answer', () => {
    const docsApp = new AladoServer(
      baseOptions('swagger-serving-reserved', { openApiDoc: { enable: true, route: '/docs', info: {} } }),
    );
    const context = {
      title: 't',
      request: {},
      options: { allowUnknownFields: false },
      response: { statusCode: 200, body: { ok: true } },
    } as any;
    for (const path of [
      '/docs',
      '/docs/swagger.json',
      '/docs/swagger-ui.css',
    ]) {
      assert.throws(
        () => docsApp.get(path, context, async () => ({ statusCode: 200, body: {} })),
        (e: any) => e instanceof AladoConfigurationError && e.code === 'ROUTE_RESERVED_FOR_OPEN_API',
        path,
      );
      assert.throws(
        () => docsApp.head(path, context, async () => ({ statusCode: 200 })),
        (e: any) =>
          e instanceof AladoConfigurationError &&
          e.code === 'ROUTE_RESERVED_FOR_OPEN_API' &&
          e.message.includes('HEAD'),
        `HEAD ${path}`,
      );
    }
    docsApp.post('/docs/swagger.json', context, async () => ({ statusCode: 200, body: {} }));
  });

  it('serves only web assets from the Swagger UI package', async () => {
    for (const path of [
      '/docs/package.json',
      '/docs/README.md',
      '/docs/LICENSE',
      '/docs/NOTICE',
    ]) {
      assert.equal((await send(port, { path })).status, 404, path);
    }
  });

  it('sends a Content-Type with each asset', async () => {
    const css = await send(port, { path: '/docs/swagger-ui.css' });
    const js = await send(port, { path: '/docs/swagger-ui-bundle.js' });
    assert.match(css.headers['content-type'] as string, /^text\/css/);
    assert.match(js.headers['content-type'] as string, /^application\/javascript/);
  });

  it('serves from the root only when the docs route is /', () => {
    assert.equal(resolveSwaggerUiFile('', '/'), 'index.html');
    assert.equal(resolveSwaggerUiFile('/swagger-ui.css', '/'), 'swagger-ui.css');
    assert.equal(resolveSwaggerUiFile('/swagger-ui.css', '/docs'), undefined);
    assert.match(
      swaggerIndexHtml('<html><head><title>x</title></head></html>', '/'),
      /<head>\n {4}<base href="\/" \/>/,
    );
  });
});
