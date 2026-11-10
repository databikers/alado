import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer } from '../../src';
import { baseOptions, close, listen, send } from '../helpers/http';

describe('an empty body', () => {
  let app: AladoServer;
  let port: number;

  before(async () => {
    app = new AladoServer(baseOptions('empty-body'));
    app.post(
      '/open',
      {
        title: 't',
        options: { allowUnknownFields: true },
        request: {},
        response: { statusCode: 200, body: {} },
      } as any,
      async (r: any) => ({
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: { has: 'body' in r, body: r.body ?? null },
      }),
    );
    port = await listen(app);
  });

  after(() => close(app));

  const post = (contentType?: string) =>
    send(port, {
      method: 'POST',
      path: '/open',
      headers: contentType ? { 'Content-Type': contentType } : {},
      body: '',
    }).then((r) => r.json());

  it('without a Content-Type is no body', async () => {
    assert.deepEqual(await post(), { has: false, body: null });
  });

  it('is the empty text for text types', async () => {
    assert.deepEqual(await post('text/plain'), { has: true, body: '' });
    assert.deepEqual(await post('text/csv'), { has: true, body: '' });
    // bytes, not text: given as request.rawBodyBytes
    assert.deepEqual(await post('application/octet-stream'), { has: true, body: {} });
  });

  it('is an empty object for JSON, XML and forms', async () => {
    for (const type of [
      'application/json',
      'application/xml',
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=x',
    ]) {
      assert.deepEqual(await post(type), { has: true, body: {} }, type);
    }
  });
});
