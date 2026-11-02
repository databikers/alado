import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'stream';
import {
  AladoServer,
  Request,
  defineRequest,
  defineResponse,
  get,
  initializeApplication,
  post,
  transformProperty,
  validateProperty,
} from '../../src';
import { baseOptions, close, listen, send, sendJson } from '../helpers/http';

const appId = 'hot-path';
const json = { 'Content-Type': 'application/json' };
const doc = defineResponse({ statusCode: 200, headers: json, body: { ok: true } });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class MixedBodyDto {
  @validateProperty({
    required: true,
    handler: (v: unknown) => typeof v === 'string',
    error: { statusCode: 400, message: 'sync failed' },
  })
  @transformProperty((v: string) => v.toUpperCase())
  a: string = 'a';

  @validateProperty({
    required: true,
    handler: async (v: unknown) => {
      await sleep(1);
      return v === 'ok';
    },
    error: { statusCode: 422, message: 'async failed' },
  })
  @transformProperty(async (v: string) => {
    await sleep(1);
    return `${v}!`;
  })
  b: string = 'ok';

  @validateProperty({
    handler: (v: unknown) => typeof v === 'number',
    error: { statusCode: 400, message: 'after async failed' },
  })
  c: number = 1;
}

class RejectingBodyDto {
  @validateProperty({
    handler: async () => {
      throw new Error('internal detail');
    },
    error: { statusCode: 400, message: 'rejected' },
  })
  r: string = 'x';
}

class ThrowingTransformBodyDto {
  @validateProperty({
    handler: async () => true,
    error: { statusCode: 400, message: 'transform failed' },
  })
  @transformProperty(() => {
    throw new Error('internal detail');
  })
  t: string = 'x';
}

class HotPathController {
  @get('/Static/Path', { appId })
  @doc
  async staticPath() {
    return { statusCode: 200, headers: json, body: { ok: true } };
  }

  @get('/len', { appId })
  @doc
  async len() {
    return { statusCode: 200, headers: json, body: { word: 'ünïcödé' } };
  }

  @get('/own-length', { appId })
  @doc
  async ownLength() {
    return { statusCode: 200, headers: { 'Content-Type': 'text/plain', 'content-length': '2' }, body: 'hi' };
  }

  @get('/no-content', { appId })
  @defineResponse({ statusCode: 204 })
  async noContent() {
    return { statusCode: 204 };
  }

  @get('/streamed', { appId })
  @doc
  async streamed() {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/plain' },
      body: Readable.from([
        'x',
        'y',
      ]) as any,
    };
  }

  @post('/mixed', { appId })
  @defineRequest({ body: MixedBodyDto })
  @doc
  async mixed(req: Request) {
    return { statusCode: 200, headers: json, body: req.body };
  }

  @post('/rejecting', { appId })
  @defineRequest({ body: RejectingBodyDto })
  @doc
  async rejecting() {
    return { statusCode: 200, headers: json, body: {} };
  }

  @post('/throwing-transform', { appId })
  @defineRequest({ body: ThrowingTransformBodyDto })
  @doc
  async throwingTransform() {
    return { statusCode: 200, headers: json, body: {} };
  }
}

let app: AladoServer;
let port: number;

before(async () => {
  app = initializeApplication({ serverOptions: baseOptions(appId), controllers: [HotPathController] });
  port = await listen(app);
});

after(() => close(app));

describe('response framing', () => {
  it('sends Content-Length (in bytes) instead of chunked encoding', async () => {
    const r = await send(port, { path: '/len' });
    assert.equal(r.status, 200);
    assert.equal(r.headers['transfer-encoding'], undefined);
    assert.equal(Number(r.headers['content-length']), Buffer.byteLength(r.text));
  });

  it('sends Content-Length on error responses', async () => {
    const r = await send(port, { path: '/missing' });
    assert.equal(r.status, 404);
    assert.equal(Number(r.headers['content-length']), Buffer.byteLength(r.text));
  });

  it('keeps a Content-Length set by the handler', async () => {
    const r = await send(port, { path: '/own-length' });
    assert.equal(r.headers['content-length'], '2');
    assert.equal(r.text, 'hi');
  });

  it('sends no Content-Length with 204', async () => {
    const r = await send(port, { path: '/no-content' });
    assert.equal(r.status, 204);
    assert.equal(r.headers['content-length'], undefined);
  });

  it('keeps streaming bodies chunked', async () => {
    const r = await send(port, { path: '/streamed' });
    assert.equal(r.text, 'xy');
    assert.equal(r.headers['transfer-encoding'], 'chunked');
  });
});

describe('static route lookup', () => {
  it('matches param-less routes case-insensitively, as the RegExp matcher did', async () => {
    assert.equal((await send(port, { path: '/static/path' })).status, 200);
    assert.equal((await send(port, { path: '/STATIC/PATH/' })).status, 200);
    assert.equal((await send(port, { path: '/static/path/more' })).status, 404);
  });
});

describe('sync and async validators', () => {
  it('runs sync and async validators and transforms in declaration order', async () => {
    const r = await sendJson(port, 'POST', '/mixed', { a: 'x', b: 'ok', c: 1, extra: true });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json(), { a: 'X', b: 'ok!', c: 1 });
  });

  it('returns the async validator error', async () => {
    const r = await sendJson(port, 'POST', '/mixed', { a: 'x', b: 'nope', c: 1 });
    assert.equal(r.status, 422);
    assert.deepEqual(r.json(), { message: 'async failed' });
  });

  it('keeps validating after an async validator', async () => {
    const r = await sendJson(port, 'POST', '/mixed', { a: 'x', b: 'ok', c: 'not a number' });
    assert.equal(r.status, 400);
    assert.deepEqual(r.json(), { message: 'after async failed' });
  });

  it('maps a rejecting async validator to the configured error', async () => {
    const r = await sendJson(port, 'POST', '/rejecting', { r: 'x' });
    assert.equal(r.status, 400);
    assert.deepEqual(r.json(), { message: 'rejected' });
  });

  it('maps a throwing transform after an async validator to the configured error', async () => {
    const r = await sendJson(port, 'POST', '/throwing-transform', { t: 'x' });
    assert.equal(r.status, 400);
    assert.deepEqual(r.json(), { message: 'transform failed' });
  });
});
