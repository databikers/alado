import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createReadStream, mkdtempSync, rmSync, writeFileSync, ReadStream } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AladoServer } from '../../src';
import { baseOptions, close, listen, send } from '../helpers/http';

const dir = mkdtempSync(join(tmpdir(), 'alado-stream-headers-'));
const file = join(dir, 'report.txt');
writeFileSync(file, 'report');

const context = {
  title: 'download',
  request: {},
  options: { allowUnknownFields: true },
  response: { statusCode: 200, body: {} },
} as any;

describe('stream responses with headers Node refuses', () => {
  const logged: unknown[] = [];
  const app = new AladoServer(
    baseOptions('stream-headers', { logger: { log: () => undefined, error: (e: unknown) => logged.push(e) } }),
  );
  let lastStream: ReadStream | undefined;
  const stream = (): ReadStream => (lastStream = createReadStream(file));
  let port: number;

  before(async () => {
    // a download whose file name comes from the request: a common pattern
    app.get('/download', context, async (req: any) => ({
      statusCode: 200,
      headers: { 'Content-Disposition': `attachment; filename="${req.query.name}"` },
      body: stream(),
    }));
    app.get('/undefined-header', context, async () => ({
      statusCode: 200,
      headers: { 'X-Missing': undefined as unknown as string },
      body: stream(),
    }));
    app.get('/bad-status', context, async () => ({ statusCode: 42, body: stream() }));
    port = await listen(app);
  });

  after(async () => {
    await close(app);
    rmSync(dir, { recursive: true, force: true });
  });

  const closed = (s: ReadStream | undefined) =>
    new Promise<boolean>((resolve) => (s?.closed ? resolve(true) : s?.once('close', () => resolve(true))));

  it('streams the file when the header is valid', async () => {
    const r = await send(port, { path: '/download?name=report.txt' });
    assert.equal(r.status, 200);
    assert.equal(r.text, 'report');
    assert.equal(r.headers['content-disposition'], 'attachment; filename="report.txt"');
  });

  it('answers 500 to a header value with a line break, logs it, closes the file and keeps running', async () => {
    logged.length = 0;
    const r = await send(port, { path: '/download?name=a%0Ab.txt' });
    assert.equal(r.status, 500);
    assert.deepEqual(r.json(), { message: 'Internal Server Error' });
    assert.equal((logged[0] as any).code, 'ERR_INVALID_CHAR');
    assert.equal(await closed(lastStream), true);
    assert.equal((await send(port, { path: '/download?name=ok.txt' })).status, 200);
  });

  it('answers 500 to an undefined header value and to an invalid status code', async () => {
    assert.equal((await send(port, { path: '/undefined-header' })).status, 500);
    assert.equal(await closed(lastStream), true);
    assert.equal((await send(port, { path: '/bad-status' })).status, 500);
    assert.equal(await closed(lastStream), true);
    assert.equal((await send(port, { path: '/download?name=ok.txt' })).status, 200);
  });
});
