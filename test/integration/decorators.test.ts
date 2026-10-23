import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defineRequest, defineResponse, get, initializeApplication, post, validateProperty } from '../../src';
import { baseOptions, close, listen, send, sendJson } from '../helpers/http';

const json = { 'Content-Type': 'application/json' };

describe('decorator registry', () => {
  it('registers routes declared before initializeApplication (deferred registration)', async () => {
    const appId = 'deco-deferred';
    class LateController {
      @get('/late', { appId })
      @defineResponse({ statusCode: 200, headers: json, body: { ok: true } })
      async late() {
        return { statusCode: 200, headers: json, body: { ok: true } };
      }
    }
    const app = initializeApplication({ serverOptions: baseOptions(appId), controllers: [LateController] });
    const port = await listen(app);
    try {
      assert.equal((await send(port, { path: '/late' })).status, 200);
    } finally {
      await close(app);
    }
  });

  it('registers routes declared after initializeApplication (immediate registration)', async () => {
    const appId = 'deco-immediate';
    const app = initializeApplication({ serverOptions: baseOptions(appId), controllers: [] });
    class EarlyAppController {
      @get('/early', { appId })
      @defineResponse({ statusCode: 200, headers: json, body: { ok: true } })
      async early() {
        return { statusCode: 200, headers: json, body: { ok: true } };
      }
    }
    void EarlyAppController;
    const port = await listen(app);
    try {
      assert.equal((await send(port, { path: '/early' })).status, 200);
    } finally {
      await close(app);
    }
  });

  it('throws at startup when a route has no @defineResponse', () => {
    const appId = 'deco-no-response';
    class MissingResponseController {
      @get('/x', { appId })
      async x() {
        return { statusCode: 200, headers: json, body: {} };
      }
    }
    assert.throws(() =>
      initializeApplication({ serverOptions: baseOptions(appId), controllers: [MissingResponseController] }),
    );
  });

  it('keeps DTOs with the same class name in different modules separate', async () => {
    const appId = 'deco-collision';
    const makeOrdersDto = () => {
      class CreateDto {
        @validateProperty({
          required: true,
          handler: (v: unknown) => typeof v === 'number',
          error: { statusCode: 400, message: 'qty' },
        })
        qty: number = 1;
      }
      return CreateDto;
    };
    const makeUsersDto = () => {
      class CreateDto {
        @validateProperty({
          required: true,
          handler: (v: unknown) => typeof v === 'string',
          error: { statusCode: 400, message: 'email' },
        })
        email: string = 'a@b.co';
      }
      return CreateDto;
    };
    const OrdersDto = makeOrdersDto();
    const UsersDto = makeUsersDto();
    assert.equal(OrdersDto.name, UsersDto.name);

    class OrdersCtl {
      @post('/orders', { appId })
      @defineRequest({ body: OrdersDto })
      @defineResponse({ statusCode: 200, headers: json, body: { ok: true } })
      async create(req: any) {
        return { statusCode: 200, headers: json, body: req.body };
      }
    }
    class UsersCtl {
      @post('/users', { appId })
      @defineRequest({ body: UsersDto })
      @defineResponse({ statusCode: 200, headers: json, body: { ok: true } })
      async create(req: any) {
        return { statusCode: 200, headers: json, body: req.body };
      }
    }
    const app = initializeApplication({
      serverOptions: baseOptions(appId),
      controllers: [
        OrdersCtl,
        UsersCtl,
      ],
    });
    const port = await listen(app);
    try {
      const orders = await sendJson(port, 'POST', '/orders', { qty: 2, email: 'x' });
      assert.equal(orders.status, 200, orders.text);
      assert.deepEqual(orders.json(), { qty: 2 });
      const users = await sendJson(port, 'POST', '/users', { email: 'a@b.co', qty: 2 });
      assert.equal(users.status, 200, users.text);
      assert.deepEqual(users.json(), { email: 'a@b.co' });
      assert.equal((await sendJson(port, 'POST', '/users', { qty: 2 })).status, 400);
    } finally {
      await close(app);
    }
  });

  it('keeps same-named controllers with the same method name separate', async () => {
    const appId = 'deco-collision-ctl';
    const makeController = (path: string, status: number) => {
      class ItemsController {
        @get(path, { appId })
        @defineResponse({ statusCode: status, headers: json, body: { path } })
        async list() {
          return { statusCode: status, headers: json, body: { path } };
        }
      }
      return ItemsController;
    };
    const A = makeController('/a', 200);
    const B = makeController('/b', 201);
    const app = initializeApplication({
      serverOptions: baseOptions(appId),
      controllers: [
        A,
        B,
      ],
    });
    const port = await listen(app);
    try {
      const a = await send(port, { path: '/a' });
      const b = await send(port, { path: '/b' });
      assert.deepEqual(
        [
          a.status,
          a.json(),
        ],
        [
          200,
          { path: '/a' },
        ],
      );
      assert.deepEqual(
        [
          b.status,
          b.json(),
        ],
        [
          201,
          { path: '/b' },
        ],
      );
    } finally {
      await close(app);
    }
  });
});
