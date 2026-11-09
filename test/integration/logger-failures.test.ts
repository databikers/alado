import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer } from '../../src';
import { baseOptions, close, listen, send } from '../helpers/http';

const context = {
  title: 't',
  request: {},
  options: { allowUnknownFields: true },
  response: { statusCode: 200, body: { ok: true } },
} as any;

// console.error replaced for one test, so the reported errors can be checked
async function capturingConsole(run: () => Promise<void>): Promise<unknown[][]> {
  const calls: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => calls.push(args);
  try {
    await run();
  } finally {
    console.error = original;
  }
  return calls;
}

describe('a logger that throws', () => {
  for (const [
    name,
    logger,
  ] of [
    [
      'error()',
      {
        log: () => undefined,
        error: () => {
          throw new Error('log transport down');
        },
      },
    ],
    [
      'log() without error()',
      {
        log: () => {
          throw new Error('log transport down');
        },
      },
    ],
  ] as const) {
    describe(name, () => {
      const app = new AladoServer(baseOptions(`logger-failures-${name.length}`, { logger }));
      let port: number;

      before(async () => {
        app.get('/boom', context, async () => {
          throw new Error('db down');
        });
        app.get('/ok', context, async () => ({ statusCode: 200, body: { ok: true } }));
        port = await listen(app);
      });

      after(() => close(app));

      it('still answers 500, reports both errors to the console and keeps the server running', async () => {
        let status: number = 0;
        const calls = await capturingConsole(async () => {
          status = (await send(port, { path: '/boom' })).status;
        });
        assert.equal(status, 500);
        assert.equal(calls.length, 1);
        assert.equal((calls[0][1] as Error).message, 'log transport down');
        assert.equal((calls[0][2] as Error).message, 'db down');
        assert.equal((await send(port, { path: '/ok' })).status, 200);
      });
    });
  }
});

describe('an error response that cannot be written', () => {
  const logged: unknown[] = [];
  // a header value Node refuses: every response, the error response too, fails to write
  const app = new AladoServer(
    baseOptions('logger-failures-headers', {
      headers: { 'X-Broken': 'a\nb' },
      logger: { log: () => undefined, error: (e: unknown) => logged.push(e) },
    }),
  );
  let port: number;

  before(async () => {
    app.get('/ok', context, async () => ({ statusCode: 200, body: { ok: true } }));
    port = await listen(app);
  });

  after(() => close(app));

  it('drops the connection instead of ending the process', async () => {
    await assert.rejects(send(port, { path: '/ok' }));
    assert.ok(logged.some((e: any) => e?.code === 'ERR_INVALID_CHAR'));
    await assert.rejects(send(port, { path: '/ok' }));
  });
});

describe('an async logger', () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

  before(() => {
    process.on('unhandledRejection', onUnhandled);
  });

  after(() => {
    process.off('unhandledRejection', onUnhandled);
  });

  for (const [
    name,
    logger,
  ] of [
    [
      'error() rejecting',
      {
        log: async () => undefined,
        error: async () => {
          throw new Error('log transport down');
        },
      },
    ],
    [
      'log() rejecting, no error()',
      {
        log: async () => {
          throw new Error('log transport down');
        },
      },
    ],
  ] as const) {
    describe(name, () => {
      const app = new AladoServer(baseOptions(`logger-failures-async-${name.length}`, { logger: logger as any }));
      let port: number;

      before(async () => {
        app.get('/boom', context, async () => {
          throw new Error('db down');
        });
        app.get('/ok', context, async () => ({ statusCode: 200, body: { ok: true } }));
        port = await listen(app);
      });

      after(() => close(app));

      it('answers 500, reports both errors to the console, leaves no unhandled rejection', async () => {
        unhandled.length = 0;
        let status: number = 0;
        const calls = await capturingConsole(async () => {
          status = (await send(port, { path: '/boom' })).status;
          await settle();
        });
        assert.equal(status, 500);
        assert.equal(calls.length, 1);
        assert.equal((calls[0][1] as Error).message, 'log transport down');
        assert.equal((calls[0][2] as Error).message, 'db down');
        assert.deepEqual(unhandled, []);
        assert.equal((await send(port, { path: '/ok' })).status, 200);
      });
    });
  }

  it('is used as it is when its promise resolves', async () => {
    const logged: unknown[] = [];
    const app = new AladoServer(
      baseOptions('logger-failures-async-ok', {
        logger: { log: async () => undefined, error: async (e: unknown) => void logged.push(e) },
      }),
    );
    app.get('/boom', context, async () => {
      throw new Error('db down');
    });
    const port = await listen(app);
    try {
      const calls = await capturingConsole(async () => {
        assert.equal((await send(port, { path: '/boom' })).status, 500);
        await settle();
      });
      assert.deepEqual(calls, []);
      assert.equal((logged[0] as Error).message, 'db down');
    } finally {
      await close(app);
    }
  });

  it('cannot end the process from the router while a route is refused at startup', async () => {
    unhandled.length = 0;
    const app = new AladoServer(
      baseOptions('logger-failures-router', {
        logger: {
          log: async () => {
            throw new Error('log transport down');
          },
        },
      }),
    );
    const calls = await capturingConsole(async () => {
      // no response definition: refused at registration, which the router logs
      assert.throws(() => app.get('/bad', { title: 't', request: {} } as any, async () => ({ statusCode: 200 })));
      await settle();
    });
    assert.equal(calls.length, 1);
    assert.match(String(calls[0][2]), /Detected an error during the defining route GET \/bad/);
    assert.deepEqual(unhandled, []);
  });
});
