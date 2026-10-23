import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'stream';
import { spawnSync } from 'child_process';
import { resolve as resolvePath } from 'path';
import {
  AladoServer,
  Request,
  defineRequest,
  defineResponse,
  del,
  get,
  head,
  initializeApplication,
  patch,
  post,
  put,
  query,
  validateProperty,
} from '../../src';
import { Router } from '../../src/router';
import { HttpMethod } from '../../src/constants';
import { baseOptions, close, listen, send, sendJson } from '../helpers/http';

const appId = 'routing';
const json = { 'Content-Type': 'application/json' };
const doc = defineResponse({ statusCode: 200, headers: json, body: { ok: true } });
const anyString = { handler: (v: unknown) => typeof v === 'string', error: { statusCode: 400, message: 'bad' } };

class NestedPathDto {
  @validateProperty({ ...anyString, required: true })
  userId: string = '1';

  @validateProperty({ ...anyString, required: true })
  postId: string = '1';
}

class RoutingController {
  @get('/ping', { appId })
  @doc
  async ping() {
    return { statusCode: 200, headers: json, body: { pong: true } };
  }

  @get('/users/:userId/posts/:postId', { appId })
  @defineRequest({ path: NestedPathDto })
  @doc
  async nested(req: Request) {
    return { statusCode: 200, headers: json, body: req.path };
  }

  @get('/undeclared/:id', { appId })
  @doc
  async undeclared(req: Request) {
    return { statusCode: 200, headers: json, body: { path: req.path } };
  }

  @get('/file.json', { appId })
  @doc
  async file() {
    return { statusCode: 200, headers: json, body: { route: 'file.json' } };
  }

  @post('/echo', { appId })
  @doc
  async postEcho(req: Request) {
    return { statusCode: 201, headers: json, body: { method: req.method, body: req.body } };
  }

  @put('/echo', { appId })
  @doc
  async putEcho(req: Request) {
    return { statusCode: 200, headers: json, body: { method: req.method, body: req.body } };
  }

  @patch('/echo', { appId })
  @doc
  async patchEcho(req: Request) {
    return { statusCode: 200, headers: json, body: { method: req.method, body: req.body } };
  }

  @query('/echo', { appId })
  @doc
  async queryEcho(req: Request) {
    return { statusCode: 200, headers: json, body: { method: req.method, body: req.body } };
  }

  @del('/echo', { appId })
  @defineResponse({ statusCode: 204 })
  async delEcho() {
    return { statusCode: 204 };
  }

  @head('/echo', { appId })
  @defineResponse({ statusCode: 200, headers: { 'X-Head': '1' }, body: 'ok' })
  async headEcho() {
    return { statusCode: 200, headers: { 'X-Head': '1' } };
  }

  @get('/text', { appId })
  @doc
  async text() {
    return { statusCode: 200, headers: { 'Content-Type': 'text/plain' }, body: 'plain text' };
  }

  @get('/stream', { appId })
  @doc
  async stream() {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/plain' },
      body: Readable.from([
        'a',
        'b',
        'c',
      ]) as any,
    };
  }

  @get('/boom', { appId })
  @doc
  async boom(): Promise<any> {
    throw new Error('db password is hunter2');
  }

  @get('/custom-header', { appId })
  @doc
  async customHeader() {
    return { statusCode: 200, headers: { ...json, 'X-Global': 'overridden' }, body: {} };
  }
}

let app: AladoServer;
let port: number;

before(async () => {
  app = initializeApplication({
    serverOptions: baseOptions(appId, { headers: { 'X-Global': 'yes', 'X-Powered-By': 'alado' } }),
    controllers: [RoutingController],
  });
  port = await listen(app);
});

after(() => close(app));

describe('routing', () => {
  it('serves a static route', async () => {
    const r = await send(port, { path: '/ping' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json(), { pong: true });
    assert.match(r.headers['content-type'] as string, /application\/json/);
  });

  it('extracts multiple path params', async () => {
    const r = await send(port, { path: '/users/42/posts/abc' });
    assert.deepEqual(r.json(), { userId: '42', postId: 'abc' });
  });

  it('ignores a trailing slash and repeated slashes', async () => {
    assert.equal((await send(port, { path: '/ping/' })).status, 200);
    assert.equal((await send(port, { path: '//ping' })).status, 200);
  });

  it('matches paths case-insensitively', async () => {
    assert.equal((await send(port, { path: '/PING' })).status, 200);
  });

  it('ignores the query string when matching', async () => {
    assert.equal((await send(port, { path: '/ping?x=1' })).status, 200);
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const r = await send(port, { path: '/nope' });
    assert.equal(r.status, 404);
    assert.deepEqual(r.json(), { message: 'Not Found' });
  });

  it('returns 404 when the path exists but the method does not', async () => {
    const r = await sendJson(port, 'POST', '/ping', {});
    assert.equal(r.status, 404);
  });

  it('does not let a path param swallow an extra segment', async () => {
    assert.equal((await send(port, { path: '/users/42/posts/abc/extra' })).status, 404);
  });

  it('strips path params that have no DTO (strict by default)', async () => {
    const r = await send(port, { path: '/undeclared/7' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json().path, {});
  });

  it(
    'treats a dot in a route as a literal dot',
    { todo: 'BUG: route strings are inserted into a RegExp unescaped, so /file.json also matches /fileXjson' },
    async () => {
      assert.equal((await send(port, { path: '/fileXjson' })).status, 404);
    },
  );

  for (const method of [
    'POST',
    'PUT',
    'PATCH',
    'QUERY',
  ]) {
    it(`parses a JSON body for ${method}`, async () => {
      const r = await sendJson(port, method, '/echo', {});
      assert.ok(
        [
          200,
          201,
        ].includes(r.status),
        `status ${r.status}`,
      );
      assert.equal(r.json().method, method);
    });
  }

  it('returns the status code chosen by the handler', async () => {
    const r = await sendJson(port, 'POST', '/echo', {});
    assert.equal(r.status, 201);
  });

  it('supports DELETE with 204 and no body', async () => {
    const r = await send(port, { method: 'DELETE', path: '/echo' });
    assert.equal(r.status, 204);
    assert.equal(r.text, '');
  });

  it('supports HEAD', async () => {
    const r = await send(port, { method: 'HEAD', path: '/echo' });
    assert.equal(r.status, 200);
    assert.equal(r.headers['x-head'], '1');
  });

  it('sends non-JSON bodies as-is', async () => {
    const r = await send(port, { path: '/text' });
    assert.equal(r.text, 'plain text');
  });

  it('pipes stream bodies', async () => {
    const r = await send(port, { path: '/stream' });
    assert.equal(r.text, 'abc');
  });

  it('applies global headers and lets the handler override them', async () => {
    const r1 = await send(port, { path: '/ping' });
    assert.equal(r1.headers['x-global'], 'yes');
    assert.equal(r1.headers['x-powered-by'], 'alado');
    const r2 = await send(port, { path: '/custom-header' });
    assert.equal(r2.headers['x-global'], 'overridden');
  });

  it('turns a thrown handler error into a JSON 500', async () => {
    const r = await send(port, { path: '/boom' });
    assert.equal(r.status, 500);
    assert.equal(typeof r.json().message, 'string');
  });

  it(
    'does not leak internal error messages to the client',
    { todo: 'SECURITY: unhandled errors return e.message verbatim in the 500 body' },
    async () => {
      const r = await send(port, { path: '/boom' });
      assert.doesNotMatch(r.text, /hunter2/);
    },
  );

  it('keeps serving after a handler error', async () => {
    await send(port, { path: '/boom' }).catch(() => undefined);
    assert.equal((await send(port, { path: '/ping' })).status, 200);
  });
});

describe('router matching order', () => {
  const makeRouter = () =>
    new Router(
      { cors: { enable: false, allowedMethods: new Map() }, openApiDoc: undefined, logger: { log() {} } } as any,
      {},
    );
  const ctx = { title: 't', options: { allowUnknownFields: false }, request: {}, response: { statusCode: 204 } } as any;

  it('static route wins when it is registered first', () => {
    const r = makeRouter();
    r.use(HttpMethod.GET, '/items/featured', ctx, () => ({ statusCode: 204 }));
    r.use(HttpMethod.GET, '/items/:id', ctx, () => ({ statusCode: 204 }));
    assert.deepEqual(r.parse(HttpMethod.GET, '/items/featured')?.path, {});
  });

  it('static route wins regardless of registration order', () => {
    const r = makeRouter();
    r.use(HttpMethod.GET, '/items/:id', ctx, () => ({ statusCode: 204 }));
    r.use(HttpMethod.GET, '/items/featured', ctx, () => ({ statusCode: 204 }));
    assert.deepEqual(r.parse(HttpMethod.GET, '/items/featured')?.path, {});
    assert.deepEqual(r.parse(HttpMethod.GET, '/items/42')?.path, { id: '42' });
  });

  it('prefers the route with fewer params when both match', () => {
    const r = makeRouter();
    r.use(HttpMethod.GET, '/u/:a/:b', ctx, () => ({ statusCode: 204 }));
    r.use(HttpMethod.GET, '/u/:a/settings', ctx, () => ({ statusCode: 204 }));
    assert.deepEqual(r.parse(HttpMethod.GET, '/u/1/settings')?.path, { a: '1' });
    assert.deepEqual(r.parse(HttpMethod.GET, '/u/1/2')?.path, { a: '1', b: '2' });
  });

  it('keeps registration order between routes with the same number of params', () => {
    const r = makeRouter();
    let hit = '';
    r.use(HttpMethod.GET, '/x/:a/c', ctx, () => {
      hit = 'first';
      return { statusCode: 204 };
    });
    r.use(HttpMethod.GET, '/x/b/:c', ctx, () => {
      hit = 'second';
      return { statusCode: 204 };
    });
    r.parse(HttpMethod.GET, '/x/b/c')?.handler({} as any);
    assert.equal(hit, 'first');
  });

  it('keeps CORS preflight working after reordering', () => {
    const r = new Router(
      { cors: { enable: true, allowedMethods: new Map() }, openApiDoc: undefined, logger: { log() {} } } as any,
      {},
    );
    r.use(HttpMethod.GET, '/items/:id', ctx, () => ({ statusCode: 204 }));
    r.use(HttpMethod.GET, '/items/featured', ctx, () => ({ statusCode: 204 }));
    assert.ok(r.parse(HttpMethod.OPTIONS, '/items/featured'));
    assert.ok(r.parse(HttpMethod.OPTIONS, '/items/9'));
  });

  it('maps param positions to names', () => {
    const r = makeRouter();
    r.use(HttpMethod.GET, '/a/:x/b/:y', ctx, () => ({ statusCode: 204 }));
    assert.deepEqual(r.parse(HttpMethod.GET, '/a/1/b/2')?.path, { x: '1', y: '2' });
  });

  it('rejects unknown HTTP methods and non-function handlers at registration', () => {
    const r = makeRouter();
    assert.throws(() => r.use('TRACE' as any, '/x', ctx, () => ({ statusCode: 204 })));
    assert.throws(() => r.use(HttpMethod.GET, '/x', ctx, 'nope' as any));
  });
});

describe('application lifecycle', () => {
  it('start() is idempotent while listening', () => {
    const s1 = app.start();
    const s2 = app.start();
    assert.equal(s1, s2);
    assert.equal(app.listening, true);
  });

  it('initializeApplication returns the same server for the same appId', () => {
    const again = initializeApplication({ serverOptions: baseOptions(appId), controllers: [] });
    assert.equal(again, app);
  });

  it('isolates apps with different appIds', async () => {
    class OtherAppController {
      @get('/other', { appId: 'routing-other' })
      @doc
      async other() {
        return { statusCode: 200, headers: json, body: { app: 'other' } };
      }
    }
    const other = initializeApplication({
      serverOptions: baseOptions('routing-other'),
      controllers: [OtherAppController],
    });
    const otherPort = await listen(other);
    try {
      assert.equal((await send(otherPort, { path: '/other' })).status, 200);
      assert.equal((await send(otherPort, { path: '/ping' })).status, 404);
      assert.equal((await send(port, { path: '/other' })).status, 404);
    } finally {
      await close(other);
    }
  });
});

describe('controller constructor options', () => {
  it(
    'binds handlers to the constructed instance so constructor options are usable',
    { todo: 'BUG: handlers are bound to the prototype, so values set in the constructor are undefined' },
    async () => {
      class GreetingService {
        greet(name: string) {
          return `hi ${name}`;
        }
      }
      class GreetController {
        constructor(private readonly service: GreetingService) {}

        @get('/greet', { appId: 'routing-ctor' })
        @doc
        async greet() {
          return { statusCode: 200, headers: json, body: { text: this.service.greet('pablo') } };
        }
      }
      const a = initializeApplication({
        serverOptions: baseOptions('routing-ctor'),
        controllers: [{ controller: GreetController, options: [new GreetingService()] }],
      });
      const p = await listen(a);
      try {
        const r = await send(p, { path: '/greet' });
        assert.equal(r.status, 200);
        assert.deepEqual(r.json(), { text: 'hi pablo' });
      } finally {
        await close(a);
      }
    },
  );
});

describe('process stability', () => {
  // Runs in a child process: the failure mode is an unhandled rejection that
  // terminates Node, which would otherwise take the test runner down with it.
  const script = (srcPath: string) => `
    const http = require('http');
    const { initializeApplication } = require(${JSON.stringify(srcPath)});
    const app = initializeApplication({ serverOptions: { port: 0, host: '127.0.0.1', cors: { enable: false },
      openApiDoc: { enable: false }, logger: { log() {}, error() {} } }, controllers: [] });
    app.get('/x', { title: 'x', options: { allowUnknownFields: false }, request: {}, response: { statusCode: 200, body: {} } },
      async () => ({ statusCode: 200, body: { a: 1 } }));
    const s = app.start(() => {
      http.get({ host: '127.0.0.1', port: s.address().port, path: '/x', agent: false }, (res) => res.resume()).on('error', () => {});
      setTimeout(() => { process.stdout.write('ALIVE'); process.exit(0); }, 800);
    });
  `;

  it(
    'survives a handler that returns an object body without Content-Type',
    {
      todo: 'BUG (crash): res.end(object) throws, respondError writes headers twice -> unhandled rejection exits the process',
    },
    () => {
      const r = spawnSync(
        process.execPath,
        [
          '-e',
          script(resolvePath(__dirname, '../../src')),
        ],
        {
          encoding: 'utf8',
          timeout: 10000,
        },
      );
      assert.equal(r.stdout, 'ALIVE', r.stderr.split('\n').slice(0, 3).join('\n'));
    },
  );
});
