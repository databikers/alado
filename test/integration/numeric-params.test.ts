import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer, validate } from '../../src';
import { baseOptions, close, listen, send } from '../helpers/http';

const bad = (message: string) => ({ statusCode: 400, message });
const describeValue = (v: unknown) => ({ type: typeof v, value: String(v) });

describe('numeric query and path params', () => {
  const app = new AladoServer(baseOptions('numeric-params'));
  let port: number;

  before(async () => {
    app.get(
      '/items/:id',
      {
        title: 'items',
        request: {
          path: {
            id: {
              validation: {
                required: true,
                handler: validate.number().integer().positive().buildSync(),
                error: bad('id'),
              },
            },
          },
          query: {
            limit: { validation: { handler: validate.number().max(100).build(), error: bad('limit') } },
            cursor: { validation: { handler: validate.bigint().build(), error: bad('cursor') } },
            name: { validation: { handler: validate.string().build(), error: bad('name') } },
          },
        },
        options: { allowUnknownFields: false },
        response: { statusCode: 200, body: {} },
      } as any,
      async (req: any) => ({
        statusCode: 200,
        body: {
          id: describeValue(req.path.id),
          limit: describeValue(req.query.limit),
          cursor: describeValue(req.query.cursor),
          name: describeValue(req.query.name),
        },
      }),
    );
    port = await listen(app);
  });

  after(() => close(app));

  it('converts values for number() and bigint() validators before validating them', async () => {
    const r = await send(port, { path: '/items/42?limit=0x10&cursor=123456789012345678901234567890&name=007' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json(), {
      id: { type: 'number', value: '42' },
      limit: { type: 'number', value: '16' },
      cursor: { type: 'bigint', value: '123456789012345678901234567890' },
      name: { type: 'string', value: '007' },
    });
  });

  it('refuses values that are not well-formed numbers or break the rules', async () => {
    assert.deepEqual((await send(port, { path: '/items/abc' })).json(), { message: 'id' });
    assert.deepEqual((await send(port, { path: '/items/1.5' })).json(), { message: 'id' });
    assert.deepEqual((await send(port, { path: '/items/-3' })).json(), { message: 'id' });
    assert.deepEqual((await send(port, { path: '/items/1?limit=1e3' })).json(), { message: 'limit' });
    assert.deepEqual((await send(port, { path: '/items/1?limit=%2012' })).json(), { message: 'limit' });
    assert.deepEqual((await send(port, { path: '/items/1?cursor=1.5' })).json(), { message: 'cursor' });
    assert.deepEqual((await send(port, { path: '/items/1?limit=1&limit=2' })).json(), { message: 'limit' });
  });
});
