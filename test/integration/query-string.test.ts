import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer } from '../../src';
import { baseOptions, close, listen, send } from '../helpers/http';

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
  app = new AladoServer(baseOptions('query-string'));
  const echo = async (req: any) => ({ statusCode: 200, headers: json, body: { query: req.query, url: req.url } });
  app.get('/q', open, echo);
  app.get('/', open, echo);
  port = await listen(app);
});

after(() => close(app));

describe('query string is not normalised like a path', () => {
  it('keeps repeated slashes and a trailing slash inside values', async () => {
    const res = await send(port, { path: '/q?next=https://example.com/a/&sig=abc//def' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json().query, { next: 'https://example.com/a/', sig: 'abc//def' });
  });

  it('keeps the raw query string in request.url while the path is normalised', async () => {
    const res = await send(port, { path: '//q/?next=https://example.com/' });
    assert.equal(res.status, 200);
    assert.equal(res.json().url, '/q?next=https://example.com/');
  });

  it('keeps a value that ends with a slash (base64)', async () => {
    const res = await send(port, { path: '/q?token=ab%2Bc/' });
    assert.deepEqual(res.json().query, { token: 'ab+c/' });
  });

  it('routes the root path when only a query string follows it', async () => {
    const res = await send(port, { path: '/?a=1' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json(), { query: { a: '1' }, url: '/?a=1' });
  });
});
