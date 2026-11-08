import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer } from '../../src';
import { baseOptions, close, listen, multipart, send } from '../helpers/http';

const context = {
  title: 'echo',
  request: {},
  options: { allowUnknownFields: true },
  response: { statusCode: 200, body: { ok: true } },
} as any;

describe('multipart parts sent empty', () => {
  const app = new AladoServer(baseOptions('multipart-empty-parts'));
  let port: number;

  before(async () => {
    app.post('/echo', context, async (req: any) => {
      const files: Record<string, { size: number; mimetype: string }> = {};
      for (const name in req.files) {
        files[name] = { size: req.files[name].size, mimetype: req.files[name].mimetype };
      }
      return { statusCode: 200, body: { body: req.body, files } };
    });
    port = await listen(app);
  });

  after(() => close(app));

  const post = async (parts: Parameters<typeof multipart>[0]) => {
    const { body, contentType } = multipart(parts);
    return (await send(port, { method: 'POST', path: '/echo', headers: { 'Content-Type': contentType }, body })).json();
  };

  it('keeps a field with an empty value', async () => {
    const r = await post([
      { name: 'middleName', value: '' },
      { name: 'name', value: 'Ann' },
    ]);
    assert.deepEqual(r.body, { middleName: '', name: 'Ann' });
  });

  it('keeps an empty file', async () => {
    const r = await post([{ name: 'log', value: '', filename: 'empty.txt', contentType: 'text/plain' }]);
    assert.deepEqual(r.files, { log: { size: 0, mimetype: 'text/plain' } });
  });

  it('keeps a file sent with an empty file name', async () => {
    const r = await post([{ name: 'log', value: 'abc', filename: '', contentType: 'text/plain' }]);
    assert.deepEqual(r.files, { log: { size: 3, mimetype: 'text/plain' } });
    assert.deepEqual(r.body, {});
  });

  it('skips a file input left empty (no file chosen)', async () => {
    const r = await post([
      { name: 'avatar', value: '', filename: '', contentType: 'application/octet-stream' },
      { name: 'name', value: 'Ann' },
    ]);
    assert.deepEqual(r.files, {});
    assert.deepEqual(r.body, { name: 'Ann' });
  });
});
