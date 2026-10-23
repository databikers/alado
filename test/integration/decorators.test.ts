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

  it(
    'keeps DTOs with the same class name in different modules separate',
    { todo: 'BUG: definitions are keyed by constructor.name, so same-named DTOs merge their rules' },
    async () => {
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

      class OrdersCtl {
        @post('/orders', { appId })
        @defineRequest({ body: OrdersDto })
        @defineResponse({ statusCode: 200, headers: json, body: { ok: true } })
        async create() {
          return { statusCode: 200, headers: json, body: { ok: true } };
        }
      }
      class UsersCtl {
        @post('/users', { appId })
        @defineRequest({ body: UsersDto })
        @defineResponse({ statusCode: 200, headers: json, body: { ok: true } })
        async create() {
          return { statusCode: 200, headers: json, body: { ok: true } };
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
        const r = await sendJson(port, 'POST', '/orders', { qty: 2 });
        assert.equal(r.status, 200, r.text);
      } finally {
        await close(app);
      }
    },
  );
});
