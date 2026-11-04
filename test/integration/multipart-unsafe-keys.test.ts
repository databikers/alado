import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer } from '../../src';
import { baseOptions, close, listen, multipart, send } from '../helpers/http';

const json = { 'Content-Type': 'application/json' };
const open = {
  title: 'echo',
  options: { allowUnknownFields: true },
  request: {},
  response: { statusCode: 200, body: {} },
} as any;

let app: AladoServer;
let port: number;

before(async () => {
  app = new AladoServer(baseOptions('multipart-unsafe-keys'));
  app.post('/form', open, async (req: any) => ({
    statusCode: 200,
    headers: json,
    body: {
      bodyKeys: Object.getOwnPropertyNames(req.body),
      bodyProto: Object.getPrototypeOf(req.body) === Object.prototype,
      fileKeys: Object.getOwnPropertyNames(req.files),
      filesProto: Object.getPrototypeOf(req.files) === Object.prototype,
      inheritedSize: 'size' in req.files,
    },
  }));
  port = await listen(app);
});

after(() => close(app));

function post(parts: Parameters<typeof multipart>[0]) {
  const { body, contentType } = multipart(parts);
  return send(port, { method: 'POST', path: '/form', headers: { 'Content-Type': contentType }, body });
}

describe('multipart field and file names', () => {
  it('does not let a file named __proto__ replace the prototype of request.files', async () => {
    const res = await post([
      { name: '__proto__', value: 'hello', filename: 'a.txt', contentType: 'text/plain' },
      { name: ' __proto__', value: 'hello', filename: 'b.txt', contentType: 'text/plain' },
      { name: 'ok', value: 'hello', filename: 'c.txt', contentType: 'text/plain' },
    ]);
    assert.equal(res.status, 200);
    const out = res.json();
    assert.equal(out.filesProto, true);
    assert.equal(out.inheritedSize, false);
    assert.deepEqual(out.fileKeys, ['ok']);
  });

  it('drops the same field names as the JSON and urlencoded parsers', async () => {
    const res = await post([
      { name: '__proto__', value: 'x' },
      { name: 'constructor', value: 'x' },
      { name: 'prototype', value: 'x' },
      { name: 'keep', value: 'x' },
    ]);
    assert.equal(res.status, 200);
    const out = res.json();
    assert.equal(out.bodyProto, true);
    assert.deepEqual(out.bodyKeys, ['keep']);
  });
});
