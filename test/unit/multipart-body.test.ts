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

  it('skips a file input left empty, parts without a name or headers, and files without a type', () => {
    const raw = body('XX', [
      filePart('avatar', Buffer.alloc(0), ''),
      Buffer.from('\r\nheaderless'),
      Buffer.from('Content-Disposition: form-data\r\n\r\nnameless'),
      Buffer.from('Content-Disposition: form-data; name="f"; filename="a"\r\n\r\nno type'),
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

  it('drops a part cut off before its closing delimiter and keeps the ones before it', () => {
    const raw = body('XX', [
      fieldPart('done', '1'),
      fieldPart('cut', '2'),
    ]);
    const truncated = raw.subarray(0, raw.length - 12);
    assert.deepEqual(text(parseMultipartBody(truncated, 'XX').fields), [
      [
        'done',
        '1',
      ],
    ]);
  });

  it('returns nothing without the boundary in the body', () => {
    assert.deepEqual(parseMultipartBody(Buffer.from('no parts here'), 'XX'), { fields: [], files: [] });
  });

  it('scans a large body without its closing delimiter in linear time', () => {
    const raw = Buffer.from('--XX\r\nContent-Disposition: form-data; name="f"' + '\r\n\r\n'.repeat(256 * 1024) + 'x');
    const started = Date.now();
    assert.deepEqual(parseMultipartBody(raw, 'XX'), { fields: [], files: [] });
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

  it('refuses more data than the declared length', async () => {
    await assert.rejects(parse(pieces(16 * 1024), { 'content-length': String(raw.length - 100) }), {
      statusCode: 400,
    });
  });
});
