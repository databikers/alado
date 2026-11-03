import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer, Request, defineResponse, initializeApplication, post } from '../../src';
import { baseOptions, close, listen, send } from '../helpers/http';

const appId = 'multipart-parser';
const json = { 'Content-Type': 'application/json' };

class MultipartController {
  @post('/form', { appId })
  @defineResponse({ statusCode: 200, headers: json, body: {} })
  async form(req: Request) {
    return { statusCode: 200, headers: json, body: { ok: true, rawLength: (req.rawBody || '').length } };
  }
}

let app: AladoServer;
let port: number;

before(async () => {
  app = initializeApplication({
    serverOptions: baseOptions(appId, { maxBodySizeBytes: 4 * 1024 * 1024 }),
    controllers: [MultipartController],
  });
  port = await listen(app);
});

after(() => close(app));

describe('multipart parser', () => {
  it('parses an unterminated part full of blank lines in linear time', async () => {
    // 1 MB of "\r\n\r\n" without the closing "\r\n--": 3.3.0 spent minutes in the part RegExp
    const body = '--XX\r\nContent-Disposition: form-data; name="f"' + '\r\n\r\n'.repeat(256 * 1024) + 'x';
    const started = Date.now();
    const r = await send(port, {
      method: 'POST',
      path: '/form',
      headers: { 'Content-Type': 'multipart/form-data; boundary=XX' },
      body,
    });
    const elapsed = Date.now() - started;
    assert.equal(r.status, 200);
    assert.ok(elapsed < 1000, `took ${elapsed} ms`);
  });

  it('reads the field name from the headers even when filename comes first', async () => {
    const { parseMultipartPart } = await import('../../src/helpers/parser/body-parser');
    const part = parseMultipartPart(
      '\r\nContent-Disposition: form-data; filename="photo.png"; name="avatar"\r\nContent-Type: image/png\r\n\r\nDATA\r\n--',
    );
    assert.deepEqual(part, { name: 'avatar', value: 'DATA', filename: 'photo.png', mimetype: ' image/png' });
  });

  it('does not take header fields from the value', async () => {
    const { parseMultipartPart } = await import('../../src/helpers/parser/body-parser');
    const part = parseMultipartPart(
      '\r\nContent-Disposition: form-data; name="note"\r\n\r\nfilename="evil.exe"\r\nContent-Type: x\r\n--',
    );
    assert.deepEqual(part, {
      name: 'note',
      value: 'filename="evil.exe"\r\nContent-Type: x',
      filename: null,
      mimetype: null,
    });
  });

  it('accepts a quoted boundary', async () => {
    const { multipartBoundary } = await import('../../src/helpers/parser/body-parser');
    assert.equal(multipartBoundary('multipart/form-data; boundary="a b"'), 'a b');
    assert.equal(multipartBoundary('multipart/form-data; boundary=XX; charset=utf-8'), 'XX');
    assert.equal(multipartBoundary('multipart/form-data'), null);
  });
});
