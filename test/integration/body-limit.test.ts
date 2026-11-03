import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'net';
import { AladoServer, Request, defineResponse, initializeApplication, post } from '../../src';
import { baseOptions, close, listen, send } from '../helpers/http';

const json = { 'Content-Type': 'application/json' };
// the documented default; deliberately not imported, so a changed default fails here
const defaultMaxBodySizeBytes = 1024 * 1024;
const doc = defineResponse({ statusCode: 200, headers: json, body: { ok: true } });

class DefaultLimitController {
  @post('/size', { appId: 'body-limit-default' })
  @doc
  async size(req: Request) {
    return { statusCode: 200, headers: json, body: { length: (req.rawBody || '').length } };
  }
}

class NoLimitController {
  @post('/size', { appId: 'body-limit-off' })
  @doc
  async size(req: Request) {
    return { statusCode: 200, headers: json, body: { length: (req.rawBody || '').length } };
  }
}

/** Sends only the request head: the body it announces never arrives. */
function sendHeadOnly(port: number, contentLength: number): Promise<{ head: string; closed: boolean }> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    let data = '';
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ head: data, closed: false });
    }, 2000);
    socket.on('data', (chunk) => (data += chunk.toString()));
    socket.on('close', () => {
      clearTimeout(timer);
      resolve({ head: data, closed: true });
    });
    socket.on('error', reject);
    socket.write(
      `POST /size HTTP/1.1\r\nHost: localhost\r\nContent-Type: text/plain\r\nContent-Length: ${contentLength}\r\n\r\n`,
    );
  });
}

let limited: AladoServer;
let unlimited: AladoServer;
let limitedPort: number;
let unlimitedPort: number;

before(async () => {
  // no maxBodySizeBytes: the default applies
  limited = initializeApplication({
    serverOptions: baseOptions('body-limit-default'),
    controllers: [DefaultLimitController],
  });
  unlimited = initializeApplication({
    serverOptions: baseOptions('body-limit-off', { maxBodySizeBytes: 0 }),
    controllers: [NoLimitController],
  });
  limitedPort = await listen(limited);
  unlimitedPort = await listen(unlimited);
});

after(async () => {
  await close(limited);
  await close(unlimited);
});

describe('default body size limit', () => {
  it('accepts a body at the limit', async () => {
    const r = await send(limitedPort, {
      method: 'POST',
      path: '/size',
      headers: { 'Content-Type': 'text/plain' },
      body: 'x'.repeat(defaultMaxBodySizeBytes),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json(), { length: defaultMaxBodySizeBytes });
  });

  it('rejects a body over the limit when the server sets none', async () => {
    const r = await send(limitedPort, {
      method: 'POST',
      path: '/size',
      headers: { 'Content-Type': 'text/plain' },
      body: 'x'.repeat(defaultMaxBodySizeBytes + 1),
    }).catch((e) => e);
    if (r instanceof Error) {
      assert.match(r.message, /ECONNRESET|socket hang up|EPIPE/);
    } else {
      assert.equal(r.status, 413);
    }
  });

  it('answers 413 from Content-Length alone and closes the connection', async () => {
    const r = await sendHeadOnly(limitedPort, 50 * 1024 * 1024);
    assert.match(r.head, /^HTTP\/1\.1 413/);
    assert.match(r.head, /connection: close/i);
    assert.equal(r.closed, true, 'the server should close the connection instead of waiting for the body');
  });

  it('can be switched off with maxBodySizeBytes: 0', async () => {
    const size = defaultMaxBodySizeBytes * 2;
    const r = await send(unlimitedPort, {
      method: 'POST',
      path: '/size',
      headers: { 'Content-Type': 'text/plain' },
      body: 'x'.repeat(size),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json(), { length: size });
  });
});
