import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer } from '../../src';
import { baseOptions, close, listen, send } from '../helpers/http';

const json = { 'Content-Type': 'application/json' };
const anything = { handler: () => true, error: { statusCode: 400, message: 'Bad Request' } };
const invalid = { message: 'Invalid request body: an object is expected' };

let app: AladoServer;
let port: number;

before(async () => {
  app = new AladoServer(baseOptions('request-part-type'));
  const echo = async (req: any) => ({
    statusCode: 200,
    headers: json,
    body: { type: Array.isArray(req.body) ? 'array' : typeof req.body, body: req.body },
  });
  app.post(
    '/typed',
    {
      title: 'typed',
      request: { body: { name: { validation: anything } } },
      response: { statusCode: 200, body: {} },
    } as any,
    echo,
  );
  app.post(
    '/open',
    {
      title: 'open',
      options: { allowUnknownFields: true },
      request: { body: { name: { validation: anything } } },
      response: { statusCode: 200, body: {} },
    } as any,
    echo,
  );
  app.post(
    '/raw',
    {
      title: 'raw',
      options: { allowUnknownFields: true },
      request: {},
      response: { statusCode: 200, body: {} },
    } as any,
    echo,
  );
  port = await listen(app);
});

after(() => close(app));

const post = (path: string, contentType: string | undefined, body: string) =>
  send(port, { method: 'POST', path, headers: contentType ? { 'Content-Type': contentType } : {}, body });

describe('a route with declared body fields', () => {
  it('rejects a JSON array, string, number or boolean body with 400', async () => {
    for (const body of [
      '["a",{"name":"x"}]',
      '"text"',
      '42',
      'true',
    ]) {
      for (const path of [
        '/typed',
        '/open',
      ]) {
        const res = await post(path, 'application/json', body);
        assert.equal(res.status, 400, `${path} ${body}`);
        assert.deepEqual(res.json(), invalid);
      }
    }
  });

  it('rejects a text body with 400 instead of a 500', async () => {
    for (const contentType of [
      'text/plain',
      undefined,
    ]) {
      const res = await post('/typed', contentType, 'hello');
      assert.equal(res.status, 400);
      assert.deepEqual(res.json(), invalid);
    }
  });

  it('treats an empty or null body as no fields', async () => {
    assert.deepEqual((await post('/typed', undefined, '')).json(), { type: 'object', body: {} });
    assert.deepEqual((await post('/typed', 'application/json', 'null')).json(), { type: 'object', body: {} });
  });

  it('accepts an object body', async () => {
    const res = await post('/typed', 'application/json', '{"name":"x","extra":1}');
    assert.deepEqual(res.json(), { type: 'object', body: { name: 'x' } });
  });
});

describe('a route without declared body fields and allowUnknownFields', () => {
  it('still passes any body through untouched', async () => {
    assert.deepEqual((await post('/raw', 'application/json', '[1,2]')).json(), {
      type: 'array',
      body: [
        1,
        2,
      ],
    });
    assert.deepEqual((await post('/raw', 'text/plain', 'hello')).json(), { type: 'string', body: 'hello' });
  });
});
