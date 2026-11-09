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

  it('a field declared as a string refuses a repeated value instead of keeping the last one', async () => {
    const one = await send(port, { method: 'POST', path: '/strict', headers: form, body: 'name=a' });
    assert.deepEqual(one.json(), { name: 'a' });
    const twice = await send(port, { method: 'POST', path: '/strict', headers: form, body: 'name=a&name=b' });
    assert.equal(twice.status, 400);
  });
});
