import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  AladoServer,
  Request,
  defineRequest,
  defineResponse,
  fileUploadProperty,
  initializeApplication,
  post,
} from '../../src';
import { baseOptions, close, listen, send } from '../helpers/http';

const appId = 'multipart-parser';
const json = { 'Content-Type': 'application/json' };

class DocFilesDto {
  @fileUploadProperty({
    mimetypes: ['text/plain'],
    maxSize: 1024,
    required: true,
    requiredError: { statusCode: 400, message: 'doc is required' },
    mimetypeError: { statusCode: 415, message: 'text only' },
    maxSizeError: { statusCode: 413, message: 'too big' },
  })
  doc: any;
}

class MultipartController {
  @post('/upload', { appId })
  @defineRequest({ files: DocFilesDto })
  @defineResponse({ statusCode: 200, headers: json, body: {} })
  async upload(req: Request) {
    const { filename, size } = req.files!.doc as any;
    return { statusCode: 200, headers: json, body: { filename, size } };
  }

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
  it('refuses an unterminated part full of blank lines, in linear time', async () => {
    // 1 MB of "\r\n\r\n" without the closing "\r\n--": 3.3.0 spent minutes in the part RegExp
    const body = '--XX\r\nContent-Disposition: form-data; name="f"' + '\r\n\r\n'.repeat(256 * 1024) + 'x';
    const started = Date.now();
    const r = await send(port, {
      method: 'POST',
      path: '/upload',
      headers: { 'Content-Type': 'multipart/form-data; boundary=XX' },
      body,
    });
    const elapsed = Date.now() - started;
    assert.equal(r.status, 400);
    assert.deepEqual(r.json(), { message: 'Malformed multipart body' });
    assert.ok(elapsed < 1000, `took ${elapsed} ms`);
  });

  it('reads the field name from the headers even when filename comes first', async () => {
    const { parsePartHeaders } = await import('../../src/helpers/parser/body-parser');
    const part = parsePartHeaders(
      'Content-Disposition: form-data; filename="photo.png"; name="avatar"\r\nContent-Type: image/png',
    );
    assert.deepEqual(part, { name: 'avatar', filename: 'photo.png', mimetype: 'image/png' });
  });

  it('reads name and filename from Content-Disposition only, not from another header', async () => {
    const { parsePartHeaders } = await import('../../src/helpers/parser/body-parser');
    assert.deepEqual(parsePartHeaders('X-Junk: x; name="admin"\r\nContent-Disposition: form-data; name="user"'), {
      name: 'user',
      filename: null,
      mimetype: null,
    });
    assert.deepEqual(
      parsePartHeaders(
        'Content-Type: text/plain; name="role"; filename="x.exe"\r\nContent-Disposition: form-data; name="note"',
      ),
      { name: 'note', filename: null, mimetype: 'text/plain' },
    );
    assert.deepEqual(parsePartHeaders('Content-Type: text/plain; name="role"'), {
      name: null,
      filename: null,
      mimetype: 'text/plain',
    });
    assert.deepEqual(parsePartHeaders('content-disposition: form-data; name="lower"'), {
      name: 'lower',
      filename: null,
      mimetype: null,
    });
  });

  it('keeps only the last segment of a filename', async () => {
    const { parsePartHeaders } = await import('../../src/helpers/parser/body-parser');
    const filename = (value: string) =>
      parsePartHeaders(`Content-Disposition: form-data; name="f"; filename="${value}"`).filename;
    assert.equal(filename('../../etc/passwd'), 'passwd');
    assert.equal(filename('/abs/path/a.txt'), 'a.txt');
    assert.equal(filename('C:\\Users\\me\\cv.pdf'), 'cv.pdf');
    assert.equal(filename('..\\..\\boot.ini'), 'boot.ini');
    assert.equal(filename('..'), '');
    assert.equal(filename('dir/.'), '');
    assert.equal(filename('dir/'), '');
    assert.equal(filename('my .. v2.pdf'), 'my .. v2.pdf');
    assert.equal(filename(''), '');
  });

  it('removes control characters from name and filename', async () => {
    const { parsePartHeaders } = await import('../../src/helpers/parser/body-parser');
    const parsed = (name: string, filename: string) =>
      parsePartHeaders(`Content-Disposition: form-data; name="${name}"; filename="${filename}"`);
    assert.deepEqual(parsed('f', 'a\u0000\u001b[31mb.txt'), { name: 'f', filename: 'a[31mb.txt', mimetype: null });
    assert.deepEqual(parsed('f', 'tab\there\u007f.txt'), { name: 'f', filename: 'tabhere.txt', mimetype: null });
    // U+009B (CSI) sent as UTF-8 arrives as the latin1 pair C2 9B and is decoded back first
    const csi = Buffer.from('a\u009b2Jb.txt', 'utf8').toString('latin1');
    assert.deepEqual(parsed('f', csi), { name: 'f', filename: 'a2Jb.txt', mimetype: null });
    assert.deepEqual(parsed('do\u0000c\u001b', 'x'), { name: 'doc', filename: 'x', mimetype: null });
    // removed before the directories: what remains is ".." and names no file
    assert.equal(parsed('f', '..\u0000').filename, '');
    assert.equal(parsed('f', 'dir/\u0000').filename, '');
    // a name of control characters only is no name
    assert.equal(parsed('\u0000\u001b', 'x').name, null);
  });

  it('gives a filename with control characters to the handler without them', async () => {
    const r = await send(port, {
      method: 'POST',
      path: '/upload',
      headers: { 'Content-Type': 'multipart/form-data; boundary=XX' },
      body: '--XX\r\nContent-Disposition: form-data; name="doc"; filename="re\u001b[2Kport\u0000.txt"\r\nContent-Type: text/plain\r\n\r\nhi\r\n--XX--\r\n',
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json(), { filename: 're[2Kport.txt', size: 2 });
  });

  it('gives a traversal filename to the handler without its directories', async () => {
    const r = await send(port, {
      method: 'POST',
      path: '/upload',
      headers: { 'Content-Type': 'multipart/form-data; boundary=XX' },
      body: '--XX\r\nContent-Disposition: form-data; name="doc"; filename="../../../etc/cron.d/x"\r\nContent-Type: text/plain\r\n\r\nhi\r\n--XX--\r\n',
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json(), { filename: 'x', size: 2 });
  });

  it('does not take header fields from the value', async () => {
    const { parseMultipartBody } = await import('../../src/helpers/parser/body-parser');
    const raw = Buffer.from(
      '--XX\r\nContent-Disposition: form-data; name="note"\r\n\r\nfilename="evil.exe"\r\nContent-Type: x\r\n--XX--\r\n',
    );
    const { fields, files } = parseMultipartBody(raw, 'XX');
    assert.deepEqual(
      fields.map(
        ([
          name,
          value,
        ]) => [
          name,
          value.toString(),
        ],
      ),
      [
        [
          'note',
          'filename="evil.exe"\r\nContent-Type: x',
        ],
      ],
    );
    assert.deepEqual(files, []);
  });

  it('accepts a quoted boundary', async () => {
    const { multipartBoundary } = await import('../../src/helpers/parser/body-parser');
    assert.equal(multipartBoundary('multipart/form-data; boundary="a b"'), 'a b');
    assert.equal(multipartBoundary('multipart/form-data; boundary=XX; charset=utf-8'), 'XX');
    assert.equal(multipartBoundary('multipart/form-data'), null);
  });
});
