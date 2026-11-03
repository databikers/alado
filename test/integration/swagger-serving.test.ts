import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer, defineResponse, get, initializeApplication } from '../../src';
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

  @get('/swagger.jsonx', { appId })
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

  it('matches /swagger.json exactly', async () => {
    assert.equal((await send(port, { path: '/swagger.json' })).status, 200);
    assert.equal((await send(port, { path: '/swagger.json?v=2' })).status, 200);
    assert.deepEqual((await send(port, { path: '/swagger.jsonx' })).json(), { route: 'api' });
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
