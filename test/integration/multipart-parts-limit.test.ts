import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer, Request } from '../../src';
import { baseOptions, close, listen, send } from '../helpers/http';

const apps: AladoServer[] = [];
const json = { 'Content-Type': 'application/json' };

async function start(extra: Record<string, unknown> = {}) {
  const app = new AladoServer(baseOptions(`parts-limit-${apps.length}`, { maxBodySizeBytes: 0, ...extra }));
  app.post(
    '/form',
    {
      title: 't',
      options: { allowUnknownFields: true, rawBody: true },
      request: {},
      response: { statusCode: 200, body: {} },
    } as any,
    async (req: Request) => ({
      statusCode: 200,
      headers: json,
      body: { fields: Object.keys(req.body || {}).length, files: Object.keys(req.files || {}).length },
    }),
  );
  apps.push(app);
  return listen(app);
}

// `fields` text fields named f0, f1, ... and `files` files named d0, d1, ...
function form(fields: number, files: number = 0) {
  const parts: string[] = [];
  for (let i = 0; i < fields; i++) {
    parts.push(`--XX\r\nContent-Disposition: form-data; name="f${i}"\r\n\r\nv\r\n`);
  }
  for (let i = 0; i < files; i++) {
    parts.push(`--XX\r\nContent-Disposition: form-data; name="d${i}"; filename="d${i}.txt"\r\n\r\nx\r\n`);
  }
  return parts.join('') + '--XX--\r\n';
}

const post = (port: number, body: string) =>
  send(port, {
    method: 'POST',
    path: '/form',
    headers: { 'Content-Type': 'multipart/form-data; boundary=XX' },
    body,
  });

describe('parsing.maxParts', () => {
  after(() => Promise.all(apps.map(close)));

  it('accepts 1000 parts by default and refuses 1001, files and fields counted together', async () => {
    const port = await start();
    const ok = await post(port, form(990, 10));
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json(), { fields: 990, files: 10 });
    const refused = await post(port, form(991, 10));
    assert.equal(refused.status, 400);
    assert.deepEqual(refused.json(), { message: 'Too many multipart parts' });
  });

  it('refuses many tiny fields quickly', async () => {
    const port = await start();
    const started = Date.now();
    const r = await post(port, form(200_000));
    assert.equal(r.status, 400);
    assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
  });

  it('applies a configured limit, and 0 for no limit', async () => {
    const strict = await start({ parsing: { maxParts: 3 } });
    assert.equal((await post(strict, form(3))).status, 200);
    assert.equal((await post(strict, form(2, 2))).status, 400);
    const open = await start({ parsing: { maxParts: 0 } });
    const r = await post(open, form(5000));
    assert.equal(r.status, 200);
    assert.deepEqual(r.json(), { fields: 5000, files: 0 });
  });

  it('refuses a maxParts that is not a whole number from 0', () => {
    for (const maxParts of [
      -1,
      1.5,
      '2' as any,
    ]) {
      assert.throws(
        () => new AladoServer({ ...baseOptions('bad-max-parts'), parsing: { maxParts } }),
        /maxParts should be a whole number/,
      );
    }
  });
});
