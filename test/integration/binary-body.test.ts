import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { AladoServer } from '../../src';
import { baseOptions, close, listen, send } from '../helpers/http';

const json = { 'Content-Type': 'application/json' };
const bytes = Buffer.from([
  0xff,
  0xfe,
  0x00,
  0x80,
  0x41,
]);

describe('bodies that are not UTF-8 text', () => {
  let app: AladoServer;
  let port: number;

  before(async () => {
    app = new AladoServer(baseOptions('binary-body'));
    app.put(
      '/blob',
      {
        title: 't',
        options: { allowUnknownFields: false, rawBody: true },
        request: {},
        response: { statusCode: 200, body: {} },
      } as any,
      async (r: any) => ({
        statusCode: 200,
        headers: json,
        body: {
          hex: r.rawBodyBytes ? Buffer.from(r.rawBodyBytes).toString('hex') : null,
          isBuffer: Buffer.isBuffer(r.rawBodyBytes),
          ownMemory: r.rawBodyBytes ? r.rawBodyBytes.buffer.byteLength === r.rawBodyBytes.length : null,
          rawBody: r.rawBody ?? null,
          body: r.body,
        },
      }),
    );
    port = await listen(app);
  });

  after(() => close(app));

  const put = (headers: Record<string, string>, body: Buffer | string) =>
    send(port, { method: 'PUT', path: '/blob', headers, body });

  it('gives a binary type as its exact bytes in request.rawBodyBytes', async () => {
    for (const type of [
      'application/octet-stream',
      'image/png',
      'application/pdf',
      'Application/Octet-Stream; x=1',
    ]) {
      const r = await put({ 'Content-Type': type }, bytes);
      assert.deepEqual(r.json(), { hex: 'fffe008041', isBuffer: true, ownMemory: true, rawBody: null, body: {} }, type);
    }
  });

  it('keeps text types as text, also image/svg+xml', async () => {
    const text = await put({ 'Content-Type': 'text/plain' }, 'héllo');
    assert.deepEqual(text.json(), { hex: null, isBuffer: false, ownMemory: null, rawBody: 'héllo', body: {} });
    const svg = await put({ 'Content-Type': 'image/svg+xml' }, '<svg/>');
    assert.equal(svg.json().rawBody, '<svg/>');
  });

  it('refuses a compressed body and a charset it does not read with 415', async () => {
    const gz = await put({ ...json, 'Content-Encoding': 'gzip' }, gzipSync('{"a":1}'));
    assert.deepEqual(
      [
        gz.status,
        gz.json(),
      ],
      [
        415,
        { message: 'Unsupported Content-Encoding' },
      ],
    );
    const utf16 = await put(
      { 'Content-Type': 'application/json; charset=utf-16le' },
      Buffer.from('{"a":1}', 'utf16le'),
    );
    assert.deepEqual(
      [
        utf16.status,
        utf16.json(),
      ],
      [
        415,
        { message: 'Unsupported charset' },
      ],
    );
    assert.equal((await put({ 'Content-Type': 'application/json; charset="UTF-8"' }, '{"a":1}')).status, 200);
    assert.equal((await put({ ...json, 'Content-Encoding': 'identity' }, '{"a":1}')).status, 200);
  });
});
