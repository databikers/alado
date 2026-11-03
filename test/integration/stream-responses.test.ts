import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { createReadStream } from 'fs';
import {
  AladoServer,
  Request,
  defineRequest,
  defineResponse,
  get,
  initializeApplication,
  validateProperty,
} from '../../src';
import { baseOptions, close, listen, send } from '../helpers/http';

const appId = 'stream-responses';
const json = { 'Content-Type': 'application/json' };
const png = { 'Content-Type': 'image/png' };
const dir = mkdtempSync(join(tmpdir(), 'alado-stream-'));
writeFileSync(join(dir, 'user-1.png'), 'PNGDATA');

let endless: Readable | undefined;

class IdPathDto {
  @validateProperty({
    required: true,
    handler: (v: unknown) => typeof v === 'string' && /^\d+$/.test(v),
    error: { statusCode: 400, message: 'Bad id' },
  })
  id: string = '1';
}

class StreamController {
  @get('/user/:id/avatar', { appId })
  @defineRequest({ path: IdPathDto })
  @defineResponse({ statusCode: 200, headers: png, body: {} })
  async avatar(req: Request) {
    return { statusCode: 200, headers: png, body: createReadStream(join(dir, `user-${req.path.id}.png`)) as any };
  }

  @get('/broken', { appId })
  @defineResponse({ statusCode: 200, headers: png, body: {} })
  async broken() {
    const stream = new Readable({
      read() {
        this.push('first chunk');
        setImmediate(() => this.destroy(new Error('disk gone')));
      },
    });
    return { statusCode: 200, headers: png, body: stream as any };
  }

  @get('/endless', { appId })
  @defineResponse({ statusCode: 200, headers: png, body: {} })
  async endlessStream() {
    endless = new Readable({
      read() {
        this.push(Buffer.alloc(64 * 1024, 1));
      },
    });
    return { statusCode: 200, headers: png, body: endless as any };
  }

  @get('/ping', { appId })
  @defineResponse({ statusCode: 200, headers: json, body: { pong: true } })
  async ping() {
    return { statusCode: 200, headers: json, body: { pong: true } };
  }
}

let app: AladoServer;
let port: number;

before(async () => {
  app = initializeApplication({ serverOptions: baseOptions(appId), controllers: [StreamController] });
  port = await listen(app);
});

after(async () => {
  await close(app);
  rmSync(dir, { recursive: true, force: true });
});

describe('stream responses', () => {
  it('streams an existing file', async () => {
    const r = await send(port, { path: '/user/1/avatar' });
    assert.equal(r.status, 200);
    assert.equal(r.text, 'PNGDATA');
  });

  it('answers 404 for a missing file and keeps the server running', async () => {
    const r = await send(port, { path: '/user/999/avatar' });
    assert.equal(r.status, 404);
    assert.deepEqual(r.json(), { message: 'Not Found' });
    assert.equal((await send(port, { path: '/ping' })).status, 200);
  });

  it('cuts only the affected connection when a stream fails after it started', async () => {
    const outcome = await new Promise<{ complete: boolean; body: string }>((resolve) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/broken', agent: false }, (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk.toString()));
        res.on('error', () => undefined);
        res.on('close', () => resolve({ complete: res.complete, body }));
      });
      req.on('error', () => resolve({ complete: false, body: '' }));
    });
    assert.equal(outcome.complete, false, 'an interrupted body must not look complete');
    assert.equal((await send(port, { path: '/ping' })).status, 200);
  });

  it('destroys the source stream when the client disconnects', async () => {
    await new Promise<void>((resolve) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/endless', agent: false }, (res) => {
        res.once('data', () => {
          req.destroy();
          resolve();
        });
      });
      req.on('error', () => resolve());
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(endless?.destroyed, true);
  });
});
