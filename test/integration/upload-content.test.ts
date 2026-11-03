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
import { matchesFileSignature } from '../../src/helpers/validate/context/file-signature';
import { baseOptions, close, listen, multipart, send } from '../helpers/http';

const appId = 'upload-content';
const json = { 'Content-Type': 'application/json' };
const PNG = Buffer.from([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  0,
  0,
  0,
  13,
]);
const JPEG = Buffer.from([
  0xff,
  0xd8,
  0xff,
  0xe0,
  0,
  16,
]);
const errors = {
  requiredError: { statusCode: 400, message: 'required' },
  mimetypeError: { statusCode: 415, message: 'Unsupported file type' },
  maxSizeError: { statusCode: 413, message: 'Too big' },
};

class ImageFilesDto {
  @fileUploadProperty({
    mimetypes: [
      'image/png',
      'image/jpeg',
    ],
    maxSize: 4096,
    required: true,
    ...errors,
  })
  image: any;
}

class TextFilesDto {
  @fileUploadProperty({ mimetypes: ['text/plain'], maxSize: 4096, required: true, ...errors })
  note: any;
}

class UncheckedFilesDto {
  @fileUploadProperty({ mimetypes: ['image/png'], maxSize: 4096, required: true, verifyContent: false, ...errors })
  image: any;
}

const ok = (req: Request) => ({
  statusCode: 200,
  headers: json,
  body: { size: Object.values(req.files || {})[0]?.size },
});

class UploadController {
  @post('/image', { appId })
  @defineRequest({ files: ImageFilesDto })
  @defineResponse({ statusCode: 200, headers: json, body: {} })
  async image(req: Request) {
    return ok(req);
  }

  @post('/note', { appId })
  @defineRequest({ files: TextFilesDto })
  @defineResponse({ statusCode: 200, headers: json, body: {} })
  async note(req: Request) {
    return ok(req);
  }

  @post('/unchecked', { appId })
  @defineRequest({ files: UncheckedFilesDto })
  @defineResponse({ statusCode: 200, headers: json, body: {} })
  async unchecked(req: Request) {
    return ok(req);
  }
}

let app: AladoServer;
let port: number;

before(async () => {
  app = initializeApplication({ serverOptions: baseOptions(appId), controllers: [UploadController] });
  port = await listen(app);
});

after(() => close(app));

function upload(path: string, name: string, contentType: string, value: Buffer | string) {
  const { body, contentType: header } = multipart([{ name, filename: 'upload', contentType, value }]);
  return send(port, { method: 'POST', path, headers: { 'Content-Type': header }, body });
}

describe('upload content check', () => {
  it('accepts files whose content matches the declared type', async () => {
    assert.equal((await upload('/image', 'image', 'image/png', PNG)).status, 200);
    assert.equal((await upload('/image', 'image', 'image/jpeg', JPEG)).status, 200);
  });

  it('rejects an HTML page declared as image/png', async () => {
    const r = await upload('/image', 'image', 'image/png', '<html><script>alert(1)</script></html>');
    assert.equal(r.status, 415);
    assert.deepEqual(r.json(), { message: 'Unsupported file type' });
  });

  it('rejects a JPEG declared as PNG', async () => {
    assert.equal((await upload('/image', 'image', 'image/png', JPEG)).status, 415);
  });

  it('does not check types that have no signature', async () => {
    assert.equal((await upload('/note', 'note', 'text/plain', 'just text')).status, 200);
  });

  it('can be switched off per field with verifyContent: false', async () => {
    assert.equal((await upload('/unchecked', 'image', 'image/png', 'not a png')).status, 200);
  });

  it('knows the common signatures', () => {
    assert.equal(matchesFileSignature('image/gif', Buffer.from('GIF89a')), true);
    assert.equal(matchesFileSignature('image/webp', Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ')), true);
    assert.equal(matchesFileSignature('application/pdf', Buffer.from('%PDF-1.7')), true);
    assert.equal(
      matchesFileSignature(
        'application/zip',
        Buffer.from([
          0x50,
          0x4b,
          0x03,
          0x04,
        ]),
      ),
      true,
    );
    assert.equal(matchesFileSignature('IMAGE/PNG', PNG), true);
    assert.equal(matchesFileSignature('application/pdf', Buffer.from('MZ')), false);
    assert.equal(matchesFileSignature('image/png', undefined), false);
  });
});
