import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { IncomingMessage, get } from 'node:http';
import { AladoServer, validate } from '../../src';
import { baseOptions, close, listen, send } from '../helpers/http';

const json = { 'Content-Type': 'application/json' };

describe('small wrong answers', () => {
  let app: AladoServer;
  let port: number;

  before(async () => {
    app = new AladoServer(baseOptions('small-answers'));
    const field = (extra: Record<string, unknown> = {}) => ({
      validation: { required: true, handler: validate.string().build(), error: { statusCode: 422, message: 'field' } },
      ...extra,
    });
    app.post(
      '/echo',
      {
        title: 't',
        options: { allowUnknownFields: true },
        request: {},
        response: { statusCode: 200, body: {} },
      } as any,
      async (r: any) => ({
        statusCode: 200,
        headers: json,
        body: { body: r.body, rawStartsWithBom: r.rawBody.charCodeAt(0) === 0xfeff },
      }),
    );
    app.get(
      '/bad-header',
      {
        title: 't',
        options: { allowUnknownFields: false },
        request: {},
        response: { statusCode: 200, body: {} },
      } as any,
      async () => ({ statusCode: 200, headers: { 'X-Echo': 'a\r\nSet-Cookie: x=1' }, body: {} }),
    );
    app.get(
      '/transform',
      {
        title: 't',
        options: { allowUnknownFields: false },
        request: {
          headers: {
            'x-token': field({
              transform: () => {
                throw new Error('transform failed');
              },
            }),
          },
        },
        auth: {
          inputProperty: 'headers.x-token',
          outputProperty: 'auth',
          handler: async () => ({ id: 1 }),
          error: { statusCode: 401, message: 'no' },
        },
        response: { statusCode: 200, body: {} },
      } as any,
      async () => ({ statusCode: 200, headers: json, body: {} }),
    );
    port = await listen(app);
  });

  after(() => close(app));

  it('reads JSON and XML that start with a byte order mark', async () => {
    const jsonBody = await send(port, { method: 'POST', path: '/echo', headers: json, body: '﻿{"a":1}' });
    assert.deepEqual(
      [
        jsonBody.status,
        jsonBody.json(),
      ],
      [
        200,
        { body: { a: 1 }, rawStartsWithBom: true },
      ],
    );
    const xml = await send(port, {
      method: 'POST',
      path: '/echo',
      headers: { 'Content-Type': 'application/xml' },
      body: '﻿<a>1</a>',
    });
    assert.deepEqual(xml.json().body, { a: '1' });
  });

  it('answers 500 Internal Server Error, not "500 OK", when a handler header is refused', async () => {
    const res = await new Promise<IncomingMessage>((resolve, reject) =>
      get({ host: '127.0.0.1', port, path: '/bad-header' }, resolve).on('error', reject),
    );
    res.resume();
    assert.equal(res.statusCode, 500);
    assert.equal(res.statusMessage, 'Internal Server Error');
    assert.equal(res.headers['set-cookie'], undefined);
  });

  it("answers the field's error when its transform throws after the auth check", async () => {
    const r = await send(port, { path: '/transform', headers: { 'X-Token': 't' } });
    assert.deepEqual(
      [
        r.status,
        r.json(),
      ],
      [
        422,
        { message: 'field' },
      ],
    );
  });
});
