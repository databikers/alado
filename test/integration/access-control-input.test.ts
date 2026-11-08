import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer, RequestAuthentication } from '../../src';
import { baseOptions, close, listen, sendJson } from '../helpers/http';

const forbidden = { statusCode: 403, message: 'Forbidden' };
const auth: RequestAuthentication = {
  inputProperty: 'headers.authorization',
  outputProperty: 'auth.user',
  required: true,
  handler: async (token: string) => (token === 'secret' ? { id: 1, roles: ['admin'] } : null),
  error: { statusCode: 401, message: 'Unauthorized' },
};
const ok = async () => ({ statusCode: 200, body: { ok: true } });

describe('access-control rules reading request input', () => {
  const app = new AladoServer(baseOptions('access-control-input'));
  const seen: unknown[] = [];
  let validatorCalls = 0;
  const route = (accessControl: any[], request: any = {}) =>
    ({
      title: 'rule',
      auth,
      accessControl,
      request,
      options: { allowUnknownFields: true },
      response: { statusCode: 200, body: { ok: true } },
    }) as any;
  const recordingHandler = async (value: unknown) => {
    seen.push(value);
    return true;
  };
  let port: number;

  before(async () => {
    app.post(
      '/owner',
      route([{ inputProperty: 'body.ownerId', accessControlHandler: recordingHandler, ...forbidden }]),
      ok,
    );
    app.post(
      '/nested',
      route([{ inputProperty: 'body.owner.id', accessControlHandler: recordingHandler, ...forbidden }]),
      ok,
    );
    app.post(
      '/declared',
      route([{ inputProperty: 'body.ownerId', accessControlHandler: recordingHandler, ...forbidden }], {
        body: {
          ownerId: {
            validation: {
              required: true,
              handler: (v: unknown) => {
                validatorCalls++;
                return typeof v === 'string' && v.length === 3;
              },
              error: { statusCode: 400, message: 'ownerId' },
            },
          },
        },
      }),
      ok,
    );
    app.post(
      '/auth-value',
      route([{ inputProperty: 'auth.user', accessControlHandler: recordingHandler, ...forbidden }]),
      ok,
    );
    port = await listen(app);
  });

  after(() => close(app));

  const post = (path: string, body: unknown) => sendJson(port, 'POST', path, body, { Authorization: 'secret' });

  it('passes plain values from the body to the rule', async () => {
    seen.length = 0;
    assert.equal((await post('/owner', { ownerId: 5 })).status, 200);
    assert.equal((await post('/owner', { ownerId: 'u-5' })).status, 200);
    assert.equal((await post('/nested', { owner: { id: 'u-5' } })).status, 200);
    assert.deepEqual(seen, [
      5,
      'u-5',
      'u-5',
    ]);
  });

  it('denies an object or an array from the body without running the rule', async () => {
    seen.length = 0;
    assert.deepEqual((await post('/owner', { ownerId: { $ne: null } })).json(), { message: 'Forbidden' });
    assert.equal(
      (
        await post('/owner', {
          ownerId: [
            1,
            2,
          ],
        })
      ).status,
      403,
    );
    assert.equal((await post('/nested', { owner: { id: { $gt: '' } } })).status, 403);
    assert.deepEqual(seen, []);
  });

  it('lets a declared validator decide, once per request', async () => {
    seen.length = 0;
    validatorCalls = 0;
    assert.equal((await post('/declared', { ownerId: 'abc' })).status, 200);
    assert.equal(validatorCalls, 1);
    assert.equal((await post('/declared', { ownerId: 'abcd' })).status, 403);
    assert.deepEqual(seen, ['abc']);
  });

  it('leaves values set by the application (auth.*) alone', async () => {
    seen.length = 0;
    assert.equal((await post('/auth-value', {})).status, 200);
    assert.deepEqual(seen, [{ id: 1, roles: ['admin'] }]);
  });
});
