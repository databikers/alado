import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer, HttpError } from '../../src';
import { baseOptions, close, listen, send } from '../helpers/http';

describe('errors thrown by a handler', () => {
  let app: AladoServer;
  let port: number;
  const logged: any[] = [];

  before(async () => {
    app = new AladoServer(baseOptions('thrown-errors', { logger: { log() {}, error: (e: any) => logged.push(e) } }));
    const route = (path: string, thrown: () => unknown) =>
      app.get(
        path,
        { title: 't', options: { allowUnknownFields: false }, request: {}, response: { statusCode: 204 } } as any,
        async () => {
          throw thrown();
        },
      );
    route('/http-error', () => new HttpError(404, 'No such order'));
    route('/plain', () => ({ statusCode: 409, message: 'Already exists' }));
    route('/sdk-403', () =>
      Object.assign(new Error('AccessDenied: role/internal-prod on s3://secret-bucket'), { statusCode: 403 }),
    );
    route('/sdk-502', () => Object.assign(new Error('connect ECONNREFUSED 10.0.3.17:5432'), { statusCode: 502 }));
    route('/subclass', () => new (class OrderGone extends HttpError {})(410, 'Gone'));
    port = await listen(app);
  });

  after(() => close(app));

  const get = async (path: string) => {
    const r = await send(port, { path });
    return [
      r.status,
      r.json(),
    ];
  };

  it('answers an HttpError and a plain { statusCode, message } as thrown', async () => {
    assert.deepEqual(await get('/http-error'), [
      404,
      { message: 'No such order' },
    ]);
    assert.deepEqual(await get('/plain'), [
      409,
      { message: 'Already exists' },
    ]);
    assert.deepEqual(await get('/subclass'), [
      410,
      { message: 'Gone' },
    ]);
  });

  it('answers any other Error with a generic 500 and logs it, whatever statusCode it carries', async () => {
    logged.length = 0;
    assert.deepEqual(await get('/sdk-403'), [
      500,
      { message: 'Internal Server Error' },
    ]);
    assert.deepEqual(await get('/sdk-502'), [
      500,
      { message: 'Internal Server Error' },
    ]);
    assert.deepEqual(
      logged.map((e) => e.message),
      [
        'AccessDenied: role/internal-prod on s3://secret-bucket',
        'connect ECONNREFUSED 10.0.3.17:5432',
      ],
    );
  });

  it('keeps the built-in 400 for a malformed query string', async () => {
    const strict = new AladoServer(baseOptions('thrown-errors-query'));
    strict.get(
      '/q',
      { title: 't', options: { allowUnknownFields: true }, request: {}, response: { statusCode: 204 } } as any,
      async () => ({ statusCode: 204 }),
    );
    const p = await listen(strict);
    const r = await send(p, { path: '/q?a=%E0%A4%A' });
    assert.deepEqual(
      [
        r.status,
        r.json(),
      ],
      [
        400,
        { message: 'Malformed query string' },
      ],
    );
    await close(strict);
  });
});
