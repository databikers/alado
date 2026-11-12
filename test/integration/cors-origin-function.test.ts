import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer, CorsOriginList } from '../../src';
import { baseOptions, close, listen, send } from '../helpers/http';

describe('cors.allowedOrigin as a function', () => {
  const apps: AladoServer[] = [];
  after(() => Promise.all(apps.map(close)));
  const logged: string[] = [];

  // the partner list as the application keeps it, e.g. reloaded in the background
  let partners: string[] = ['https://a.partner.example'];
  let calls = 0;
  const current: CorsOriginList = () => {
    calls++;
    return partners;
  };

  async function start(allowedOrigin: CorsOriginList, extra: Record<string, unknown> = {}) {
    const app = new AladoServer(
      baseOptions(`cors-fn-${apps.length}`, {
        cors: { enable: true, allowedOrigin, ...extra },
        logger: { log() {}, error: (e: any) => logged.push(String(e?.message ?? e)) },
        openApiDoc: { enable: true, route: '/docs', info: { title: 't', version: '1' } },
      }),
    );
    app.get(
      '/data',
      {
        title: 't',
        options: { allowUnknownFields: false },
        request: {},
        response: { statusCode: 200, body: {} },
      } as any,
      async () => ({ statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: { ok: true } }),
    );
    apps.push(app);
    return listen(app);
  }
  const get = (port: number, origin?: string, path: string = '/data') =>
    send(port, { path, headers: origin ? { Origin: origin } : {} });

  it('uses the list the function returns now: origins added later are allowed, removed ones refused', async () => {
    partners = ['https://a.partner.example'];
    const port = await start(current);
    const ok = await get(port, 'https://a.partner.example');
    assert.equal(ok.headers['access-control-allow-origin'], 'https://a.partner.example');
    assert.equal(ok.headers.vary, 'Origin');
    assert.equal((await get(port, 'https://b.partner.example')).headers['access-control-allow-origin'], undefined);
    partners = ['https://b.partner.example'];
    assert.equal(
      (await get(port, 'https://b.partner.example')).headers['access-control-allow-origin'],
      'https://b.partner.example',
    );
    const removed = await get(port, 'https://a.partner.example');
    assert.equal(removed.status, 200);
    assert.equal(removed.headers['access-control-allow-origin'], undefined);
    assert.equal(removed.headers.vary, 'Origin');
  });

  it('takes a single origin or "*" like the static setting, with or without credentials', async () => {
    const one = await start(() => 'https://only.example');
    assert.equal((await get(one, 'https://x.example')).headers['access-control-allow-origin'], 'https://only.example');
    const any = await start(() => '*');
    assert.equal((await get(any, 'https://x.example')).headers['access-control-allow-origin'], '*');
    const anyWithCredentials = await start(() => '*', { allowedCredentials: true });
    const r = await get(anyWithCredentials, 'https://x.example');
    assert.equal(r.headers['access-control-allow-origin'], 'https://x.example');
    assert.equal(r.headers['access-control-allow-credentials'], 'true');
  });

  it('answers a preflight from the current list', async () => {
    partners = ['https://a.partner.example'];
    const port = await start(current);
    const preflight = (origin: string) =>
      send(port, {
        method: 'OPTIONS',
        path: '/data',
        headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' },
      });
    const ok = await preflight('https://a.partner.example');
    assert.equal(ok.status, 204);
    assert.equal(ok.headers['access-control-allow-origin'], 'https://a.partner.example');
    assert.equal((await preflight('https://evil.example')).headers['access-control-allow-origin'], undefined);
  });

  it('calls the function once for an API request with the docs enabled, and serves the docs with it', async () => {
    partners = ['https://a.partner.example'];
    const port = await start(current);
    calls = 0;
    await get(port, 'https://a.partner.example');
    assert.equal(calls, 1);
    const docs = await get(port, 'https://a.partner.example', '/docs/swagger.json');
    assert.equal(docs.status, 200);
    assert.equal(docs.headers['access-control-allow-origin'], 'https://a.partner.example');
  });

  it('allows no origin and logs when the function throws or returns something else; the request is still answered', async () => {
    for (const [
      bad,
      message,
    ] of [
      [
        () => {
          throw new Error('partner list not loaded');
        },
        'partner list not loaded',
      ],
      [
        () => undefined,
        'allowedOrigin() should return an origin or a list of origins',
      ],
      [
        () => [
          'https://a.partner.example',
          42,
        ],
        'allowedOrigin() should return an origin or a list of origins',
      ],
      [
        () => Promise.resolve('*'),
        'allowedOrigin() should return an origin or a list of origins',
      ],
    ] as Array<
      [
        CorsOriginList,
        string,
      ]
    >) {
      logged.length = 0;
      const port = await start(bad);
      const r = await get(port, 'https://a.partner.example');
      assert.equal(r.status, 200);
      assert.equal(r.headers['access-control-allow-origin'], undefined);
      assert.equal(logged.length, 1);
      assert.match(logged[0], new RegExp(message.replace(/[()]/g, '\\$&')));
    }
  });

  it('is accepted as allowedOrigin, unlike other non-strings', () => {
    assert.doesNotThrow(
      () =>
        new AladoServer(
          baseOptions('cors-fn-ok', { cors: { enable: true, allowedOrigin: () => ['https://a.example'] } }),
        ),
    );
    assert.throws(
      () => new AladoServer(baseOptions('cors-fn-bad', { cors: { enable: true, allowedOrigin: 42 as any } })),
      /allowedOrigin should be a non-empty string, a list of them or a function returning one/,
    );
  });
});
