import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'stream';
import { bodyParser, parseMultipartBody } from '../../src/helpers/parser/body-parser';

// every byte value, plus pieces of a delimiter inside the content
function binary(size: number): Buffer {
  const out = Buffer.alloc(size);
  for (let i = 0; i < size; i++) {
    out[i] = (i * 31 + 7) & 0xff;
  }
  Buffer.from('\r\n--X\r\n--\r\n-').copy(out, Math.floor(size / 2));
  return out;
}

const fieldPart = (name: string, value: string) =>
  Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n\r\n${value}`);
const filePart = (name: string, content: Buffer, filename = 'f.bin', type = 'application/octet-stream') =>
  Buffer.concat([
    Buffer.from(
      `Content-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`,
    ),
    content,
  ]);
const body = (boundary: string, parts: Buffer[], { preamble = '', epilogue = '' } = {}) =>
  Buffer.concat([
    Buffer.from(preamble),
    ...parts.flatMap((part) => [
      Buffer.from(`--${boundary}\r\n`),
      part,
      Buffer.from('\r\n'),
    ]),
    Buffer.from(`--${boundary}--\r\n${epilogue}`),
  ]);
const text = (
  fields: Array<
    [
      string,
      Buffer,
    ]
  >,
) =>
  fields.map(
    ([
      name,
      value,
    ]) => [
      name,
      value.toString('utf8'),
    ],
  );

describe('parseMultipartBody', () => {
  it('returns file content as a view of the body, byte for byte', () => {
    const content = binary(64 * 1024);
    const raw = body('XX', [
      fieldPart('title', 'Привіт'),
      filePart('f', content),
    ]);
    const { fields, files } = parseMultipartBody(raw, 'XX');
    assert.deepEqual(text(fields), [
      [
        'title',
        'Привіт',
      ],
    ]);
    assert.equal(files.length, 1);
    assert.ok(files[0].content.equals(content));
    // same memory as the body: no copy was made
    assert.equal(files[0].content.buffer, raw.buffer);
  });

  it('keeps empty values and empty files', () => {
    const raw = body('XX', [
      fieldPart('empty', ''),
      filePart('f', Buffer.alloc(0), 'empty.txt', 'text/plain'),
    ]);
    const { fields, files } = parseMultipartBody(raw, 'XX');
    assert.deepEqual(text(fields), [
      [
        'empty',
        '',
      ],
    ]);
    assert.deepEqual(
      files.map((f) => [
        f.name,
        f.mimetype,
        f.content.length,
      ]),
      [
        [
          'f',
          'text/plain',
          0,
        ],
      ],
    );
  });

  it('skips a file input left empty and parts without a name or headers', () => {
    const raw = body('XX', [
      filePart('avatar', Buffer.alloc(0), ''),
      Buffer.from('\r\nheaderless'),
      Buffer.from('Content-Disposition: form-data\r\n\r\nnameless'),
      fieldPart('kept', 'yes'),
    ]);
    const { fields, files } = parseMultipartBody(raw, 'XX');
    assert.deepEqual(text(fields), [
      [
        'kept',
        'yes',
      ],
    ]);
    assert.deepEqual(files, []);
  });

  it('keeps a file sent without a Content-Type as application/octet-stream, with its filename', () => {
    const raw = body('XX', [
      Buffer.from('Content-Disposition: form-data; name="f"; filename="a.dat"\r\n\r\nno type'),
      Buffer.from('Content-Disposition: form-data; name="g"; filename=""\r\n\r\nno name'),
    ]);
    assert.deepEqual(
      parseMultipartBody(raw, 'XX').files.map((f) => [
        f.name,
        f.mimetype,
        f.filename,
        f.content.toString(),
      ]),
      [
        [
          'f',
          'application/octet-stream',
          'a.dat',
          'no type',
        ],
        [
          'g',
          'application/octet-stream',
          '',
          'no name',
        ],
      ],
    );
  });

  it('ignores the preamble and the epilogue, and accepts padding after a delimiter', () => {
    const raw = Buffer.concat([
      Buffer.from('preamble --XY\r\n'),
      Buffer.from('--XX  \t\r\n'),
      fieldPart('a', '1'),
      Buffer.from('\r\n--XX--\r\nepilogue --XX\r\n'),
    ]);
    assert.deepEqual(text(parseMultipartBody(raw, 'XX').fields), [
      [
        'a',
        '1',
      ],
    ]);
  });

  it('drops a part cut off before its closing delimiter and reports the body incomplete', () => {
    const raw = body('XX', [
      fieldPart('done', '1'),
      fieldPart('cut', '2'),
    ]);
    assert.equal(parseMultipartBody(raw, 'XX').complete, true);
    const truncated = parseMultipartBody(raw.subarray(0, raw.length - 12), 'XX');
    assert.deepEqual(text(truncated.fields), [
      [
        'done',
        '1',
      ],
    ]);
    assert.equal(truncated.complete, false);
    // every part closed but no "--" after the last delimiter
    assert.equal(parseMultipartBody(Buffer.from('--XX\r\n\r\nv\r\n--XX\r\n'), 'XX').complete, false);
  });

  it('throws a 400 past maxParts, counting every part, named or not', () => {
    const raw = body('XX', [
      fieldPart('a', '1'),
      Buffer.from('\r\nheaderless'),
      filePart('f', Buffer.from('x')),
    ]);
    assert.equal(parseMultipartBody(raw, 'XX', 3).complete, true);
    assert.equal(parseMultipartBody(raw, 'XX', 0).complete, true);
    assert.throws(() => parseMultipartBody(raw, 'XX', 2), { statusCode: 400, message: 'Too many multipart parts' });
  });

  it('returns nothing without the boundary in the body', () => {
    assert.deepEqual(parseMultipartBody(Buffer.from('no parts here'), 'XX'), {
      fields: [],
      files: [],
      complete: false,
    });
  });

  it('scans a large body without its closing delimiter in linear time', () => {
    const raw = Buffer.from('--XX\r\nContent-Disposition: form-data; name="f"' + '\r\n\r\n'.repeat(256 * 1024) + 'x');
    const started = Date.now();
    assert.deepEqual(parseMultipartBody(raw, 'XX'), { fields: [], files: [], complete: false });
    assert.ok(Date.now() - started < 200);
  });
});

describe('bodyParser (multipart collection)', () => {
  const content = binary(200 * 1024);
  const raw = body('XX', [
    fieldPart('a', 'x'),
    filePart('f', content),
  ]);
  const fakeResponse: any = { headersSent: false, setHeader: () => undefined };

  const parse = async (pieces: Buffer[], headers: Record<string, string>) => {
    const req: any = Readable.from(pieces, { objectMode: false });
    req.headers = { 'content-type': 'multipart/form-data; boundary=XX', ...headers };
    return bodyParser(req, fakeResponse, 0, true);
  };
  const pieces = (size: number) => {
    const out: Buffer[] = [];
    for (let i = 0; i < raw.length; i += size) {
      out.push(raw.subarray(i, i + size));
    }
    return out;
  };
  const read = async (stream: Readable) => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  };

  it('gives the same result with and without a declared length, for any chunk size', async () => {
    for (const size of [
      1000,
      16 * 1024,
      raw.length,
    ]) {
      for (const headers of [
        { 'content-length': String(raw.length) },
        {},
      ]) {
        const r = await parse(pieces(size), headers);
        assert.deepEqual(r.body, { a: 'x' });
        assert.ok((await read(r.files.f.stream)).equals(content), `${size} ${JSON.stringify(headers)}`);
        assert.equal(r.files.f.size, content.length);
      }
    }
  });

  it('backs file contents with memory that holds this body only', async () => {
    const small = body('XX', [
      fieldPart('a', 'x'),
      filePart('f', Buffer.from('hello')),
    ]);
    for (const input of [
      { pieces: [small], headers: { 'content-length': String(small.length) } },
      { pieces: [small], headers: {} },
      {
        pieces: [
          small.subarray(0, 10),
          small.subarray(10),
        ],
        headers: {},
      },
      { pieces: pieces(16 * 1024), headers: { 'content-length': String(raw.length) } },
      { pieces: pieces(16 * 1024), headers: {} },
    ]) {
      const total = input.pieces.reduce((n, p) => n + p.length, 0);
      const r = await parse(input.pieces, input.headers);
      const chunks: Buffer[] = [];
      for await (const chunk of r.files.f.stream) {
        chunks.push(chunk);
      }
      // a view's backing memory is exactly this body: not Node's shared pool, not a socket chunk
      assert.equal(
        chunks[0].buffer.byteLength,
        total,
        `${input.pieces.length} pieces ${JSON.stringify(input.headers)}`,
      );
    }
  });

  it('refuses a cut-off body, a body without its boundary and one without a boundary parameter', async () => {
    await assert.rejects(parse([raw.subarray(0, raw.length - 10)], {}), {
      statusCode: 400,
      message: 'Malformed multipart body',
    });
    await assert.rejects(parse([Buffer.from('no delimiter at all')], {}), { statusCode: 400 });
    const req: any = Readable.from([raw], { objectMode: false });
    req.headers = { 'content-type': 'multipart/form-data' };
    await assert.rejects(bodyParser(req, fakeResponse, 0, true), { statusCode: 400 });
  });

  it('reads an empty body as an empty form, with or without a boundary parameter', async () => {
    assert.deepEqual((await parse([], {})).body, {});
    const req: any = Readable.from([], { objectMode: false });
    req.headers = { 'content-type': 'multipart/form-data' };
    assert.deepEqual((await bodyParser(req, fakeResponse, 0, true)).body, {});
  });

  it('refuses more data than the declared length', async () => {
    await assert.rejects(parse(pieces(16 * 1024), { 'content-length': String(raw.length - 100) }), {
      statusCode: 400,
    });
  });
});
