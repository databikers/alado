import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  AladoServer,
  defineRequest,
  defineResponse,
  initializeApplication,
  post,
  validate,
  validateProperty,
} from '../../src';
import { baseOptions, close, listen, send } from '../helpers/http';

const json = { 'Content-Type': 'application/json' };
const field = (message: string, handler = validate.string().build()) =>
  validateProperty({ required: true, handler, error: { statusCode: 400, message } });

describe('DTO classes that extend another DTO', () => {
  const appId = 'dto-inheritance';
  let app: AladoServer;

  after(() => close(app));

  it('keep the fields of the parent: validated, required and not stripped', async () => {
    class ContactDto {
      @field('email')
      email: string = '';
    }
    class UserDto extends ContactDto {
      @field('name')
      name: string = '';
    }
    class AdminDto extends UserDto {
      // decorated again: replaces the parent's rule
      @field('name: at least 5', validate.string().min(5).build())
      declare name: string;
    }
    class OnlyInherits extends ContactDto {}
    class Controller {
      @post('/users', { appId })
      @defineRequest({ body: UserDto })
      @defineResponse({ statusCode: 200, body: {} })
      async user(req: any) {
        return { statusCode: 200, headers: json, body: req.body };
      }

      @post('/admins', { appId })
      @defineRequest({ body: AdminDto })
      @defineResponse({ statusCode: 200, body: {} })
      async admin(req: any) {
        return { statusCode: 200, headers: json, body: req.body };
      }

      @post('/contacts', { appId })
      @defineRequest({ body: OnlyInherits })
      @defineResponse({ statusCode: 200, body: {} })
      async contact(req: any) {
        return { statusCode: 200, headers: json, body: req.body };
      }
    }
    app = initializeApplication({ serverOptions: baseOptions(appId), controllers: [Controller] });
    const port = await listen(app);
    const call = async (path: string, body: object) => {
      const r = await send(port, { method: 'POST', path, headers: json, body: JSON.stringify(body) });
      return [
        r.status,
        r.json(),
      ];
    };
    assert.deepEqual(await call('/users', { name: 'n' }), [
      400,
      { message: 'email' },
    ]);
    assert.deepEqual(await call('/users', { name: 'n', email: 'e', extra: 1 }), [
      200,
      { email: 'e', name: 'n' },
    ]);
    assert.deepEqual(await call('/admins', { name: 'abc', email: 'e' }), [
      400,
      { message: 'name: at least 5' },
    ]);
    assert.deepEqual(await call('/admins', { name: 'abcde', email: 'e' }), [
      200,
      { email: 'e', name: 'abcde' },
    ]);
    assert.deepEqual(await call('/contacts', {}), [
      400,
      { message: 'email' },
    ]);
    assert.deepEqual(await call('/contacts', { email: 'e' }), [
      200,
      { email: 'e' },
    ]);
    // the parent keeps only its own fields
    assert.deepEqual(await call('/users', { email: 'e' }), [
      400,
      { message: 'name' },
    ]);
  });
});
