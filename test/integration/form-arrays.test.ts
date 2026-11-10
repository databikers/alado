import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer, validate } from '../../src';
import { baseOptions, close, listen, multipart, send } from '../helpers/http';

const json = { 'Content-Type': 'application/json' };
const form = { 'Content-Type': 'application/x-www-form-urlencoded' };

describe('form fields follow the query rules', () => {
  let app: AladoServer;
  let port: number;

  before(async () => {
    app = new AladoServer(baseOptions('form-arrays'));
    const echo = async (r: any) => ({ statusCode: 200, headers: json, body: r.body });
    app.post(
      '/open',
      {
        title: 't',
        options: { allowUnknownFields: true },
        request: {},
        response: { statusCode: 200, body: {} },
      } as any,
      echo,
    );
    app.post(
      '/strict',
      {
        title: 't',
        options: { allowUnknownFields: false },
        request: {
          body: {
            name: {
              validation: {
                required: true,
                handler: validate.string().build(),
                error: { statusCode: 400, message: 'name' },
              },
            },
          },
        },
        response: { statusCode: 200, body: {} },
      } as any,
      echo,
    );
    port = await listen(app);
  });

  after(() => close(app));

  const expected = {
    tags: [
      'a',
      'b',
    ],
    x: [
      '1',
      '2',
    ],
    one: ['only'],
    plain: 'p',
    empty: '',
  };

  it('urlencoded: a repeated key or key[] gives an array, empty values are kept', async () => {
    const r = await send(port, {
      method: 'POST',
      path: '/open',
      headers: form,
      body: 'tags[]=a&tags[]=b&x=1&x=2&one[]=only&plain=p&empty=&__proto__[]=1&constructor=2',
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json(), expected);
  });

  it('multipart text fields give the same shape as the urlencoded form', async () => {
    const { body, contentType } = multipart([
      { name: 'tags[]', value: 'a' },
      { name: 'tags[]', value: 'b' },
      { name: 'x', value: '1' },
      { name: 'x', value: '2' },
      { name: 'one[]', value: 'only' },
      { name: 'plain', value: 'p' },
      { name: 'empty', value: '' },
      { name: '__proto__[]', value: '1' },
    ]);
    const r = await send(port, { method: 'POST', path: '/open', headers: { 'Content-Type': contentType }, body });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json(), expected);
  });

  it('converts number and bigint fields of a form, as for query values', async () => {
    const numbers = new AladoServer(baseOptions('form-numbers'));
    const numeric = (handler: any) => ({
      validation: { required: true, handler, error: { statusCode: 400, message: 'n' } },
    });
    numbers.post(
      '/n',
      {
        title: 't',
        options: { allowUnknownFields: false },
        request: {
          body: { age: numeric(validate.number().integer().min(18).build()), id: numeric(validate.bigint().build()) },
        },
        response: { statusCode: 200, body: {} },
      } as any,
      async (r: any) => ({
        statusCode: 200,
        headers: json,
        body: { age: r.body.age, id: `${typeof r.body.id}:${r.body.id}` },
      }),
    );
    const p = await listen(numbers);
    const urlencoded = await send(p, { method: 'POST', path: '/n', headers: form, body: 'age=30&id=9007199254740993' });
    assert.deepEqual(urlencoded.json(), { age: 30, id: 'bigint:9007199254740993' });
    const parts = multipart([
      { name: 'age', value: '30' },
      { name: 'id', value: '7' },
    ]);
    const multi = await send(p, {
      method: 'POST',
      path: '/n',
      headers: { 'Content-Type': parts.contentType },
      body: parts.body,
    });
    assert.deepEqual(multi.json(), { age: 30, id: 'bigint:7' });
    assert.equal((await send(p, { method: 'POST', path: '/n', headers: form, body: 'age=abc&id=7' })).status, 400);
    assert.equal((await send(p, { method: 'POST', path: '/n', headers: form, body: 'age=17&id=7' })).status, 400);
    // a JSON body is typed already: a number sent as a string stays a string and is refused
    const typed = await send(p, { method: 'POST', path: '/n', headers: json, body: '{"age":"30","id":"7"}' });
    assert.equal(typed.status, 400);
    await close(numbers);
  });

  it('a field declared as a string refuses a repeated value instead of keeping the last one', async () => {
    const one = await send(port, { method: 'POST', path: '/strict', headers: form, body: 'name=a' });
    assert.deepEqual(one.json(), { name: 'a' });
    const twice = await send(port, { method: 'POST', path: '/strict', headers: form, body: 'name=a&name=b' });
    assert.equal(twice.status, 400);
  });
});
