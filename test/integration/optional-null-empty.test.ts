import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer, validate } from '../../src';
import { baseOptions, close, listen, sendJson } from '../helpers/http';

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
