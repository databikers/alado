import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer } from '../../src';
import { baseOptions, close, listen, send } from '../helpers/http';

const json = { 'Content-Type': 'application/json' };

describe('@withAuth without `required`', () => {
  let app: AladoServer;
  let port: number;

  before(async () => {
    app = new AladoServer(baseOptions('auth-required-default'));
    const route = (auth: Record<string, unknown>) =>
      ({
        title: 't',
        options: { allowUnknownFields: false },
        request: {},
        auth: {
          inputProperty: 'headers.authorization',
          outputProperty: 'auth',
          handler: async (token: string) => (token === 'Bearer ok' ? { id: 1 } : undefined),
          error: { statusCode: 401, message: 'Unauthorized' },
          ...auth,
        },
        response: { statusCode: 200, body: {} },
      }) as any;
    const echo = async (r: any) => ({ statusCode: 200, headers: json, body: { auth: r.auth ?? null } });
    app.get('/unset', route({}), echo);
    app.get('/true', route({ required: true }), echo);
    app.get('/false', route({ required: false }), echo);
    port = await listen(app);
  });

  after(() => close(app));

  const get = (path: string, authorization?: string) =>
    send(port, { path, headers: authorization ? { Authorization: authorization } : {} });

  it('refuses a request without credentials, like required: true', async () => {
    for (const path of [
      '/unset',
      '/true',
    ]) {
      assert.equal((await get(path)).status, 401, path);
      assert.equal((await get(path, 'Bearer wrong')).status, 401, path);
      const ok = await get(path, 'Bearer ok');
      assert.equal(ok.status, 200, path);
      assert.deepEqual(ok.json(), { auth: { id: 1 } });
    }
  });

  it('lets requests through anonymously only with an explicit required: false', async () => {
    const anonymous = await get('/false');
    assert.equal(anonymous.status, 200);
    assert.deepEqual(anonymous.json(), { auth: null });
    assert.deepEqual((await get('/false', 'Bearer ok')).json(), { auth: { id: 1 } });
  });
});
