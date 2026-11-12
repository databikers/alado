import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer } from '../../src';
import { baseOptions, close, listen, send } from '../helpers/http';

describe('securityHeaders', () => {
  const apps: AladoServer[] = [];
  after(() => Promise.all(apps.map(close)));

  async function start(extra: Record<string, unknown> = {}, handlerHeaders: Record<string, string> = {}) {
    const app = new AladoServer(
      baseOptions(`security-headers-${apps.length}`, { logger: { log() {}, error() {} }, ...extra }),
    );
    const route = {
      title: 't',
      options: { allowUnknownFields: false },
      request: {},
      response: { statusCode: 200, body: {} },
    } as any;
    app.get('/ok', route, async () => ({
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', ...handlerHeaders },
      body: { ok: true },
    }));
    apps.push(app);
    return listen(app);
  }

  const preset = {
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'content-security-policy': "frame-ancestors 'none'",
  };
  const pick = (headers: Record<string, any>) =>
    Object.fromEntries(
      Object.keys(preset).flatMap((name) =>
        name in headers
          ? [
              [
                name,
                headers[name],
              ],
            ]
          : [],
      ),
    );

  it('sends none of them by default', async () => {
    const port = await start();
    assert.deepEqual(pick((await send(port, { path: '/ok' })).headers), {});
  });

  it('sends the preset with securityHeaders: true, on answers and on errors', async () => {
    const port = await start({ securityHeaders: true });
    assert.deepEqual(pick((await send(port, { path: '/ok' })).headers), preset);
    const missing = await send(port, { path: '/nowhere' });
    assert.equal(missing.status, 404);
    assert.deepEqual(pick(missing.headers), preset);
  });

  it('changes the preset with an object: a string replaces or adds, false leaves out', async () => {
    const port = await start({
      securityHeaders: {
        'referrer-policy': 'strict-origin-when-cross-origin',
        'Strict-Transport-Security': false,
        'Permissions-Policy': 'camera=()',
      },
    });
    const { headers } = await send(port, { path: '/ok' });
    assert.deepEqual(pick(headers), {
      'referrer-policy': 'strict-origin-when-cross-origin',
      'x-frame-options': 'DENY',
      'content-security-policy': "frame-ancestors 'none'",
    });
    assert.equal(headers['permissions-policy'], 'camera=()');
  });

  it('lets the headers option and the handler replace a preset header', async () => {
    const port = await start(
      { securityHeaders: true, headers: { 'x-frame-options': 'SAMEORIGIN' } },
      { 'Referrer-Policy': 'origin' },
    );
    const { headers } = await send(port, { path: '/ok' });
    assert.equal(headers['x-frame-options'], 'SAMEORIGIN');
    assert.equal(headers['referrer-policy'], 'origin');
    assert.equal(headers['strict-transport-security'], preset['strict-transport-security']);
  });

  it('refuses an option that is not true, false or header values', () => {
    for (const [
      securityHeaders,
      message,
    ] of [
      [
        'yes',
        /should be true, false or an object/,
      ],
      [
        ['X-Frame-Options'],
        /should be true, false or an object/,
      ],
      [
        { 'X-Frame-Options': 1 },
        /should be a string, or false/,
      ],
      [
        { 'Bad Name': 'x' },
        /securityHeaders\["Bad Name"\]/,
      ],
      [
        { 'X-Frame-Options': 'DENY\r\nSet-Cookie: a=b' },
        /securityHeaders\["X-Frame-Options"\]/,
      ],
    ] as Array<
      [
        unknown,
        RegExp,
      ]
    >) {
      assert.throws(() => new AladoServer(baseOptions('security-headers-bad', { securityHeaders })), message);
    }
  });
});
