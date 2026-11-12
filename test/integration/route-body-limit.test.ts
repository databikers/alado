import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer, Request, defineResponse, initializeApplication, post } from '../../src';
import { baseOptions, close, listen, multipart, send } from '../helpers/http';

const appId = 'route-body-limit';
const json = { 'Content-Type': 'application/json' };
const doc = defineResponse({ statusCode: 200, headers: json, body: { ok: true } });
const reply = (req: Request) => ({ statusCode: 200, headers: json, body: { length: (req.rawBody || '').length } });

class RouteLimitController {
  @post('/json', { appId, rawBody: true })
  @doc
  async json(req: Request) {
    return reply(req);
  }

  @post('/upload', { appId, rawBody: true, maxBodySizeBytes: 64 * 1024 })
  @doc
  async upload(req: Request) {
    return reply(req);
  }

  @post('/unlimited', { appId, rawBody: true, maxBodySizeBytes: 0 })
  @doc
  async unlimited(req: Request) {
    return reply(req);
  }
}

let app: AladoServer;
let port: number;

before(async () => {
  app = initializeApplication({
    serverOptions: baseOptions(appId, { maxBodySizeBytes: 1024 }),
    controllers: [RouteLimitController],
  });
  port = await listen(app);
});

after(() => close(app));

const text = (path: string, size: number) =>
  send(port, { method: 'POST', path, headers: { 'Content-Type': 'text/plain' }, body: 'x'.repeat(size) });

describe('a route maxBodySizeBytes', () => {
  it('keeps the server limit on a route that sets none', async () => {
    assert.equal((await text('/json', 1024)).status, 200);
    assert.equal((await text('/json', 1025)).status, 413);
  });

  it('replaces the server limit on the route that sets one, for text and multipart bodies', async () => {
    assert.deepEqual((await text('/upload', 64 * 1024)).json(), { length: 64 * 1024 });
    assert.equal((await text('/upload', 64 * 1024 + 1)).status, 413);
    const small = multipart([{ name: 'f', value: Buffer.alloc(32 * 1024, 1), filename: 'a.bin' }]);
    const big = multipart([{ name: 'f', value: Buffer.alloc(64 * 1024, 1), filename: 'a.bin' }]);
    const upload = (form: { body: Buffer; contentType: string }) =>
      send(port, { method: 'POST', path: '/upload', headers: { 'Content-Type': form.contentType }, body: form.body });
    assert.equal((await upload(small)).status, 200);
    assert.equal((await upload(big)).status, 413);
  });

  it('removes the limit on a route that sets 0', async () => {
    assert.deepEqual((await text('/unlimited', 2 * 1024 * 1024)).json(), { length: 2 * 1024 * 1024 });
  });

  it('applies to a route registered without decorators', async () => {
    const plain = new AladoServer(baseOptions('route-body-limit-plain', { maxBodySizeBytes: 16 }));
    const context = (maxBodySizeBytes?: number): any => ({
      title: 't',
      options: { allowUnknownFields: false, rawBody: true, maxBodySizeBytes },
      request: {},
      response: { statusCode: 200, body: {} },
    });
    plain.post('/small', context(), async (req: Request) => reply(req));
    plain.post('/large', context(1024), async (req: Request) => reply(req));
    const plainPort = await listen(plain);
    try {
      const body = 'x'.repeat(100);
      const headers = { 'Content-Type': 'text/plain' };
      assert.equal((await send(plainPort, { method: 'POST', path: '/small', headers, body })).status, 413);
      assert.equal((await send(plainPort, { method: 'POST', path: '/large', headers, body })).status, 200);
    } finally {
      await close(plain);
    }
  });

  it('refuses a limit that is not a number from 0', () => {
    const server = new AladoServer(baseOptions('route-body-limit-bad'));
    for (const maxBodySizeBytes of [
      -1,
      Infinity,
      NaN,
      '1024' as any,
    ]) {
      assert.throws(
        () =>
          server.post(
            '/bad',
            {
              title: 't',
              options: { allowUnknownFields: false, rawBody: true, maxBodySizeBytes },
              request: {},
              response: { statusCode: 200, body: {} },
            } as any,
            async () => ({ statusCode: 200, body: {} }),
          ),
        /maxBodySizeBytes should be a number from 0/,
      );
    }
  });
});
