import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'stream';
import {
  AladoServer,
  Request,
  defineRequest,
  defineResponse,
  fileUploadProperty,
  initializeApplication,
  post,
  validateProperty,
} from '../../src';
import { baseOptions, close, listen, multipart, send } from '../helpers/http';

const appId = 'uploads';
const json = { 'Content-Type': 'application/json' };
const doc = defineResponse({ statusCode: 200, headers: json, body: { ok: true } });

const PNG_HEADER = Buffer.from([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
]);
const ALL_BYTES = Buffer.from(Array.from({ length: 256 }, (_, i) => i));

class AvatarFilesDto {
  @fileUploadProperty({
    mimetypes: ['image/png'],
    maxSize: 1024,
    required: true,
    requiredError: { statusCode: 400, message: 'Avatar is required' },
    mimetypeError: { statusCode: 415, message: 'Only PNG allowed' },
    maxSizeError: { statusCode: 413, message: 'Max size is 1KB' },
  })
  avatar: any;

  @fileUploadProperty({
    mimetypes: ['application/pdf'],
    maxSize: 2048,
    required: false,
    requiredError: { statusCode: 400, message: 'unused' },
    mimetypeError: { statusCode: 415, message: 'Only PDF allowed' },
    maxSizeError: { statusCode: 413, message: 'Too big' },
  })
  resume: any;
}

class AvatarBodyDto {
  @validateProperty({
    required: true,
    handler: (v: unknown) => typeof v === 'string' && v.length > 0,
    error: { statusCode: 400, message: 'caption is required' },
  })
  caption: string = 'x';
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) {
    chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  }
  return Buffer.concat(chunks);
}

class UploadController {
  @post('/avatar', { appId })
  @defineRequest({ files: AvatarFilesDto, body: AvatarBodyDto })
  @doc
  async upload(req: Request) {
    const files = req.files || {};
    const avatar = files.avatar ? await readAll(files.avatar.stream) : undefined;
    return {
      statusCode: 200,
      headers: json,
      body: {
        caption: req.body?.caption,
        fileKeys: Object.keys(files).sort(),
        size: files.avatar?.size,
        mimetype: files.avatar?.mimetype,
        hex: avatar?.toString('hex'),
      },
    };
  }
}

let app: AladoServer;
let port: number;

before(async () => {
  app = initializeApplication({ serverOptions: baseOptions(appId), controllers: [UploadController] });
  port = await listen(app);
});

after(() => close(app));

function upload(parts: Parameters<typeof multipart>[0]) {
  const { body, contentType } = multipart(parts);
  return send(port, { method: 'POST', path: '/avatar', headers: { 'Content-Type': contentType }, body });
}

describe('file uploads', () => {
  it('accepts a valid file and exposes it as a stream with size and mimetype', async () => {
    const r = await upload([
      { name: 'caption', value: 'me' },
      { name: 'avatar', filename: 'a.png', contentType: 'image/png', value: PNG_HEADER },
    ]);
    assert.equal(r.status, 200);
    const b = r.json();
    assert.equal(b.caption, 'me');
    assert.equal(b.mimetype, 'image/png');
    assert.equal(b.size, PNG_HEADER.length);
    assert.equal(b.hex, PNG_HEADER.toString('hex'));
  });

  it('preserves every byte value (binary safe)', async () => {
    const r = await upload([
      { name: 'caption', value: 'bytes' },
      { name: 'avatar', filename: 'a.png', contentType: 'image/png', value: ALL_BYTES },
    ]);
    assert.equal(r.status, 200);
    assert.equal(r.json().hex, ALL_BYTES.toString('hex'));
  });

  it('returns requiredError when a required file is missing', async () => {
    const r = await upload([{ name: 'caption', value: 'me' }]);
    assert.equal(r.status, 400);
    assert.deepEqual(r.json(), { message: 'Avatar is required' });
  });

  it('returns mimetypeError for a disallowed type', async () => {
    const r = await upload([
      { name: 'caption', value: 'me' },
      { name: 'avatar', filename: 'a.gif', contentType: 'image/gif', value: 'GIF89a' },
    ]);
    assert.equal(r.status, 415);
    assert.deepEqual(r.json(), { message: 'Only PNG allowed' });
  });

  it('returns maxSizeError for an oversized file', async () => {
    const r = await upload([
      { name: 'caption', value: 'me' },
      { name: 'avatar', filename: 'a.png', contentType: 'image/png', value: Buffer.alloc(2048, 1) },
    ]);
    assert.equal(r.status, 413);
  });

  it('validates an optional file only when it is present', async () => {
    const r = await upload([
      { name: 'caption', value: 'me' },
      { name: 'avatar', filename: 'a.png', contentType: 'image/png', value: PNG_HEADER },
      { name: 'resume', filename: 'cv.txt', contentType: 'text/plain', value: 'hello' },
    ]);
    assert.equal(r.status, 415);
    assert.deepEqual(r.json(), { message: 'Only PDF allowed' });
  });

  it('drops file fields that are not declared', async () => {
    const r = await upload([
      { name: 'caption', value: 'me' },
      { name: 'avatar', filename: 'a.png', contentType: 'image/png', value: PNG_HEADER },
      { name: 'malware', filename: 'x.png', contentType: 'image/png', value: PNG_HEADER },
    ]);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json().fileKeys, ['avatar']);
  });

  it('still validates text fields sent alongside files', async () => {
    const r = await upload([{ name: 'avatar', filename: 'a.png', contentType: 'image/png', value: PNG_HEADER }]);
    assert.equal(r.status, 400);
    assert.deepEqual(r.json(), { message: 'caption is required' });
  });

  it('keeps a file whose content contains CRLF followed by --', async () => {
    const tricky = Buffer.concat([
      PNG_HEADER,
      Buffer.from('\r\n--not-a-boundary\r\n--'),
    ]);
    const r = await upload([
      { name: 'caption', value: 'me' },
      { name: 'avatar', filename: 'a.png', contentType: 'image/png', value: tricky },
    ]);
    assert.equal(r.json().hex, tricky.toString('hex'));
  });
});
