import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer, validate } from '../../src';
import { baseOptions, close, listen, send, sendJson } from '../helpers/http';

const def = (handler: any) => ({ validation: { handler, error: { statusCode: 400, message: 'invalid' } } });

describe('optional body fields sent as null or empty', () => {
  const app = new AladoServer(baseOptions('optional-null-empty'));
  let port: number;

  before(async () => {
    app.post(
      '/profile',
      {
        title: 't',
        request: {
          body: {
            email: def(validate.string().email().buildSync()),
            nick: def(validate.string().min(3).buildSync()),
            age: def(validate.number().integer().min(18).buildSync()),
            bio: def(validate.string().max(200).nullable().buildSync()),
          },
        },
        options: { allowUnknownFields: false },
        response: { statusCode: 200, body: {} },
      } as any,
      async (req: any) => ({ statusCode: 200, body: req.body }),
    );
    port = await listen(app);
  });

  after(() => close(app));

  it('go through the rules instead of passing them', async () => {
    assert.equal((await sendJson(port, 'POST', '/profile', { age: null })).status, 400);
    assert.equal((await sendJson(port, 'POST', '/profile', { email: '' })).status, 400);
    assert.equal((await sendJson(port, 'POST', '/profile', { nick: '' })).status, 400);
  });

  it('may still be left out, and null is accepted where declared nullable', async () => {
    assert.deepEqual((await sendJson(port, 'POST', '/profile', {})).json(), {});
    assert.deepEqual((await sendJson(port, 'POST', '/profile', { bio: null, age: 30 })).json(), { bio: null, age: 30 });
  });
});

describe('JSON bodies that are falsy values', () => {
  const app = new AladoServer(baseOptions('json-falsy-bodies'));
  let port: number;

  before(async () => {
    const echo = async (req: any) => ({
      statusCode: 200,
      body: { present: 'body' in req, value: req.body === undefined ? 'undefined' : req.body },
    });
    app.put(
      '/flag',
      {
        title: 't',
        request: {},
        options: { allowUnknownFields: true },
        response: { statusCode: 200, body: {} },
      } as any,
      echo,
    );
    app.put(
      '/dto',
      {
        title: 't',
        request: { body: { on: def(validate.boolean().buildSync()) } },
        options: { allowUnknownFields: false },
        response: { statusCode: 200, body: {} },
      } as any,
      echo,
    );
    port = await listen(app);
  });

  after(() => close(app));

  const put = (path: string, text: string) =>
    send(port, { method: 'PUT', path, headers: { 'Content-Type': 'application/json' }, body: text });

  it('reach the handler as sent', async () => {
    for (const [
      text,
      value,
    ] of [
      [
        'false',
        false,
      ],
      [
        '0',
        0,
      ],
      [
        '""',
        '',
      ],
      [
        'null',
        null,
      ],
    ] as const) {
      assert.deepEqual((await put('/flag', text)).json(), { present: true, value }, text);
    }
  });

  it('are still refused, or read as an empty object, where a body DTO expects an object', async () => {
    assert.equal((await put('/dto', 'false')).status, 400);
    assert.equal((await put('/dto', '0')).status, 400);
    assert.deepEqual((await put('/dto', 'null')).json(), { present: true, value: {} });
  });
});
