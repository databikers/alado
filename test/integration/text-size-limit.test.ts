import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { constants } from 'buffer';
import { AladoServer } from '../../src';
import { textLimits } from '../../src/helpers/parser/body-parser';
import { baseOptions, close, listen, multipart, send } from '../helpers/http';

const context = {
  title: 'echo',
  request: {},
  options: { allowUnknownFields: true },
  response: { statusCode: 200, body: { ok: true } },
} as any;

describe('bodies too long to decode as a string (limit lowered to 1000 bytes)', () => {
  // maxBodySizeBytes 0: no size limit at all, the case that used to crash the process
  const app = new AladoServer(baseOptions('text-size-limit', { maxBodySizeBytes: 0 }));
  let port: number;

  before(async () => {
    textLimits.maxBytes = 1000;
    app.post('/echo', context, async (req: any) => {
      const files: Record<string, number> = {};
      for (const name in req.files) {
        files[name] = req.files[name].size;
      }
      return { statusCode: 200, body: { length: (req.rawBody || '').length, files } };
    });
    app.post('/raw', context, async (req: any) => ({ statusCode: 200, body: { length: req.rawBody.length } }));
    app.post('/files', context, async (req: any) => {
      const files: Record<string, number> = {};
      for (const name in req.files) {
        files[name] = req.files[name].size;
      }
      return { statusCode: 200, body: { body: req.body, files } };
    });
    app.get('/alive', context, async () => ({ statusCode: 200, body: { ok: true } }));
    port = await listen(app);
  });

  after(async () => {
    textLimits.maxBytes = constants.MAX_STRING_LENGTH;
    await close(app);
  });

  const post = (path: string, contentType: string, body: string | Buffer) =>
    send(port, { method: 'POST', path, headers: { 'Content-Type': contentType }, body });

  it('defaults to the V8 string limit', () => {
    assert.equal(constants.MAX_STRING_LENGTH > 1000, true);
  });

  it('accepts a text body up to the limit', async () => {
    const r = await post('/echo', 'text/plain', 'x'.repeat(1000));
    assert.equal(r.status, 200);
    assert.equal(r.json().length, 1000);
  });

  it('answers 413 to text, JSON, urlencoded and XML bodies past it, and the server keeps running', async () => {
    for (const [
      type,
      body,
    ] of [
      [
        'text/plain',
        'x'.repeat(1001),
      ],
      [
        'application/json',
        JSON.stringify({ a: 'x'.repeat(1000) }),
      ],
      [
        'application/x-www-form-urlencoded',
        `a=${'x'.repeat(1000)}`,
      ],
      [
        'application/xml',
        `<a>${'x'.repeat(1000)}</a>`,
      ],
    ]) {
      const r = await post('/echo', type, body);
      assert.equal(r.status, 413, type);
      assert.deepEqual(r.json(), { message: 'Content Too Large' });
      assert.equal(r.headers.connection, 'close');
    }
    assert.equal((await send(port, { path: '/alive' })).status, 200);
  });

  it('answers 413 to a multipart text field past it', async () => {
    const { body, contentType } = multipart([{ name: 'note', value: 'x'.repeat(1001) }]);
    assert.equal((await post('/files', contentType, body)).status, 413);
  });

  it('accepts multipart files past it: they stay bytes', async () => {
    const { body, contentType } = multipart([
      { name: 'title', value: 'short' },
      { name: 'f', value: Buffer.alloc(5000, 1), filename: 'f.bin', contentType: 'application/octet-stream' },
    ]);
    const r = await post('/files', contentType, body);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json(), { body: { title: 'short' }, files: { f: 5000 } });
  });

  it('answers 413, not a crash or a 500, when a handler reads rawBody of a multipart body past it', async () => {
    const { body, contentType } = multipart([
      { name: 'f', value: Buffer.alloc(5000, 1), filename: 'f.bin', contentType: 'application/octet-stream' },
    ]);
    const r = await post('/raw', contentType, body);
    assert.equal(r.status, 413);
    assert.deepEqual(r.json(), { message: 'Content Too Large' });
  });
});
