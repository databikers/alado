import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer, UploadedFile } from '../../src';
import { baseOptions, close, listen, multipart, send } from '../helpers/http';

const json = { 'Content-Type': 'application/json' };
const fileRule = (mimetypes: string[], required = false) => ({
  mimetypes,
  maxSize: 8,
  required,
  requiredError: { statusCode: 400, message: 'required' },
  mimetypeError: { statusCode: 415, message: 'type' },
  maxSizeError: { statusCode: 413, message: 'size' },
});
const describeFile = (f: UploadedFile) => `${f.filename}:${f.mimetype}:${f.size}`;
const echo = async (r: any) => ({
  statusCode: 200,
  headers: json,
  body: Object.fromEntries(
    Object.entries(r.files).map(
      ([
        k,
        v,
      ]) => [
        k,
        Array.isArray(v) ? (v as UploadedFile[]).map(describeFile) : describeFile(v as UploadedFile),
      ],
    ),
  ),
});

function start(repeatedFiles?: 'last' | 'array', maxFilesPerField?: number) {
  const app = new AladoServer({
    ...baseOptions(`repeated-${repeatedFiles}-${maxFilesPerField}`),
    parsing: { repeatedFiles, maxFilesPerField },
  });
  app.post(
    '/upload',
    {
      title: 't',
      options: { allowUnknownFields: false },
      request: { files: { docs: fileRule(['text/plain']), raw: fileRule(['application/octet-stream']) } },
      response: { statusCode: 200, body: {} },
    } as any,
    echo,
  );
  return app;
}

const upload = (port: number, parts: Parameters<typeof multipart>[0]) => {
  const { body, contentType } = multipart(parts);
  return send(port, { method: 'POST', path: '/upload', headers: { 'Content-Type': contentType }, body });
};
const doc = (filename: string, value: string, contentType = 'text/plain') => ({
  name: 'docs',
  filename,
  value,
  contentType,
});

describe('repeated multipart files, default (one file per field name)', () => {
  let app: AladoServer;
  let port: number;
  before(async () => {
    app = start();
    port = await listen(app);
  });
  after(() => close(app));

  it('refuses a second file under the same name with 400', async () => {
    const r = await upload(port, [
      doc('a.txt', 'aa'),
      doc('b.txt', 'bbbb'),
    ]);
    assert.equal(r.status, 400);
    assert.deepEqual(r.json(), { message: 'Too many files under one field name' });
    assert.deepEqual((await upload(port, [doc('a.txt', 'aa')])).json(), { docs: 'a.txt:text/plain:2' });
  });

  it('does not count text fields, and skips undeclared file fields', async () => {
    const r = await upload(port, [
      doc('a.txt', 'aa'),
      { name: 'note', value: '1' },
      { name: 'note', value: '2' },
      { name: 'other', filename: 'x.txt', value: 'x', contentType: 'text/plain' },
      { name: 'other', filename: 'y.txt', value: 'y', contentType: 'text/plain' },
    ]);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json(), { docs: 'a.txt:text/plain:2' });
  });

  it('keeps a file sent without a Content-Type as application/octet-stream', async () => {
    const r = await upload(port, [{ name: 'raw', filename: 'x.bin', value: 'xyz' }]);
    assert.deepEqual(r.json(), { raw: 'x.bin:application/octet-stream:3' });
    const refused = await upload(port, [{ name: 'docs', filename: 'x.txt', value: 'xyz' }]);
    assert.equal(refused.status, 415, 'a field for text/plain does not take bytes of unknown type');
  });
});

describe("repeated multipart files, maxFilesPerField: 0 with repeatedFiles: 'last'", () => {
  let app: AladoServer;
  let port: number;
  before(async () => {
    app = start('last', 0);
    port = await listen(app);
  });
  after(() => close(app));

  it('keeps the last file of a repeated field', async () => {
    const r = await upload(port, [
      doc('a.txt', 'aa'),
      doc('b.txt', 'bbbb'),
    ]);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json(), { docs: 'b.txt:text/plain:4' });
  });
});

describe("repeated multipart files, parsing.repeatedFiles: 'array', maxFilesPerField: 3", () => {
  let app: AladoServer;
  let port: number;
  before(async () => {
    app = start('array', 3);
    port = await listen(app);
  });
  after(() => close(app));

  it('gives every file of a repeated field, in order', async () => {
    const r = await upload(port, [
      doc('a.txt', 'aa'),
      doc('b.txt', 'bbbb'),
      doc('c.txt', 'c'),
    ]);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json(), {
      docs: [
        'a.txt:text/plain:2',
        'b.txt:text/plain:4',
        'c.txt:text/plain:1',
      ],
    });
  });

  it('keeps a single file as it is, and name[] as a list', async () => {
    assert.deepEqual((await upload(port, [doc('a.txt', 'aa')])).json(), { docs: 'a.txt:text/plain:2' });
    const listed = await upload(port, [{ ...doc('a.txt', 'aa'), name: 'docs[]' }]);
    assert.deepEqual(listed.json(), { docs: ['a.txt:text/plain:2'] });
  });

  it('refuses more files than maxFilesPerField', async () => {
    const r = await upload(port, [
      doc('a.txt', 'a'),
      doc('b.txt', 'b'),
      doc('c.txt', 'c'),
      doc('d.txt', 'd'),
    ]);
    assert.equal(r.status, 400);
  });

  it('checks every file of the list against the rules', async () => {
    assert.equal(
      (
        await upload(port, [
          doc('a.txt', 'aa'),
          doc('b.png', 'bb', 'image/png'),
        ])
      ).status,
      415,
    );
    assert.equal(
      (
        await upload(port, [
          doc('a.txt', 'aa'),
          doc('b.txt', 'b'.repeat(9)),
        ])
      ).status,
      413,
    );
  });
});

describe('parsing options', () => {
  it('refuses a maxFilesPerField that is not a whole number from 0', () => {
    for (const maxFilesPerField of [
      -1,
      1.5,
      '2' as any,
    ]) {
      assert.throws(
        () => new AladoServer({ ...baseOptions('bad-max-files'), parsing: { maxFilesPerField } }),
        /maxFilesPerField should be a whole number/,
      );
    }
  });

  it('refuses an unknown repeatedFiles value', () => {
    assert.throws(
      () => new AladoServer({ ...baseOptions('bad-parsing'), parsing: { repeatedFiles: 'first' as any } }),
      /repeatedFiles should be 'last' or 'array'/,
    );
  });
});
