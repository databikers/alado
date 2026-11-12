import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { AladoServer, Request } from '../../src';
import { baseOptions, close, listen } from '../helpers/http';

describe('bodyIdleTimeoutMs', () => {
  const apps: AladoServer[] = [];
  // client sockets, destroyed before the servers close (a stalled upload with no limit stays open)
  const sockets: net.Socket[] = [];
  after(() => {
    sockets.forEach((socket) => socket.destroy());
    return Promise.all(apps.map(close));
  });

  async function start(extra: Record<string, unknown> = {}) {
    const app = new AladoServer(
      baseOptions(`body-idle-${apps.length}`, { logger: { log() {}, error() {} }, ...extra }),
    );
    app.post(
      '/echo',
      {
        title: 't',
        options: { allowUnknownFields: false, rawBody: true },
        request: {},
        response: { statusCode: 200, body: {} },
      } as any,
      async (req: Request) => ({
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: { length: (req.rawBody || '').length },
      }),
    );
    apps.push(app);
    return listen(app);
  }

  // sends `parts` of a 1000-byte body `gapMs` apart; resolves with the status line, when the
  // connection closed and how long it took
  function upload(port: number, parts: string[], gapMs: number) {
    return new Promise<{ status: string; closed: boolean; ms: number }>((resolve) => {
      const started = Date.now();
      const socket = net.connect(port, '127.0.0.1');
      sockets.push(socket);
      let out = '';
      let timer: NodeJS.Timeout | undefined;
      socket.on('data', (d) => (out += d));
      socket.on('error', () => {});
      socket.on('close', () => {
        clearTimeout(timer);
        resolve({ status: out.split('\r\n')[0], closed: true, ms: Date.now() - started });
      });
      socket.write('POST /echo HTTP/1.1\r\nHost: x\r\nContent-Type: text/plain\r\nContent-Length: 1000\r\n\r\n');
      let i = 0;
      const next = () => {
        if (i < parts.length && !socket.destroyed) {
          socket.write(parts[i++]);
          timer = setTimeout(next, gapMs);
        }
      };
      next();
    });
  }

  it('answers 408 and closes the connection when a body stops arriving', async () => {
    const port = await start({ bodyIdleTimeoutMs: 150 });
    // 400 of 1000 bytes, then nothing
    const r = await upload(port, ['x'.repeat(400)], 10_000);
    assert.match(r.status, /^HTTP\/1\.1 408/);
    assert.ok(r.closed);
    assert.ok(r.ms < 2000, `took ${r.ms} ms`);
  });

  it('lets a slow but steady upload finish: the timer restarts with every chunk', async () => {
    const port = await start({ bodyIdleTimeoutMs: 150 });
    // 10 chunks 80 ms apart: 800 ms in all, never 150 ms without data
    const r = await new Promise<string>((resolve) => {
      const socket = net.connect(port, '127.0.0.1');
      let out = '';
      socket.on('data', (d) => {
        out += d;
        if (out.includes('}')) {
          socket.destroy();
          resolve(out);
        }
      });
      socket.write('POST /echo HTTP/1.1\r\nHost: x\r\nContent-Type: text/plain\r\nContent-Length: 1000\r\n\r\n');
      let sent = 0;
      const tick = () => {
        socket.write('y'.repeat(100));
        if (++sent < 10) setTimeout(tick, 80);
      };
      tick();
    });
    assert.match(r, /^HTTP\/1\.1 200/);
    assert.match(r, /"length":1000/);
  });

  it('waits 30 seconds by default, and without limit with 0', async (t) => {
    const port = await start();
    const open = await start({ bodyIdleTimeoutMs: 0 });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const stalled = upload(port, ['x'.repeat(400)], 0);
    const unlimited = upload(open, ['x'.repeat(400)], 0);
    let unlimitedDone = false;
    unlimited.then(() => (unlimitedDone = true));
    // let both requests reach the body reader
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    t.mock.timers.tick(30_000);
    const r = await stalled;
    assert.match(r.status, /^HTTP\/1\.1 408/);
    t.mock.timers.tick(24 * 60 * 60 * 1000);
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(unlimitedDone, false);
  });

  it('refuses a bodyIdleTimeoutMs that is not a number from 0', () => {
    for (const bodyIdleTimeoutMs of [
      -1,
      NaN,
      '5' as any,
    ]) {
      assert.throws(
        () => new AladoServer(baseOptions('body-idle-bad', { bodyIdleTimeoutMs })),
        /bodyIdleTimeoutMs should be a number of milliseconds/,
      );
    }
  });
});
