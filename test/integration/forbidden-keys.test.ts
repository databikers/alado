import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer } from '../../src';
import { baseOptions, close, listen, send, sendJson } from '../helpers/http';

const json = { 'Content-Type': 'application/json' };
const open = {
  title: 'echo',
  options: { allowUnknownFields: true },
  request: {},
  response: { statusCode: 200, body: {} },
} as any;

let app: AladoServer;
let port: number;

before(async () => {
  app = new AladoServer(baseOptions('forbidden-keys'));
  app.post('/b', open, async (req: any) => ({
    statusCode: 200,
    headers: json,
    body: { body: req.body, ownProto: Object.prototype.hasOwnProperty.call(req.body, '__proto__') },
  }));
  port = await listen(app);
});

after(() => close(app));

describe('forbidden body keys', () => {
  it('keeps JSON fields that only contain "prototype" or "constructor"', async () => {
    const res = await sendJson(port, 'POST', '/b', {
      prototypeUrl: 'x',
      constructorId: 1,
      nested: { myConstructor: 2, constructor: 3 },
      constructor: 4,
      keep: 5,
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json().body, { prototypeUrl: 'x', constructorId: 1, nested: { myConstructor: 2 }, keep: 5 });
  });

  it('still drops __proto__ from JSON', async () => {
    const res = await send(port, {
      method: 'POST',
      path: '/b',
      headers: json,
      body: '{"__proto__":{"isAdmin":true},"keep":1}',
    });
    assert.deepEqual(res.json(), { body: { keep: 1 }, ownProto: false });
  });

  it('drops __proto__ and constructor written with \\u escapes', async () => {
    const res = await send(port, {
      method: 'POST',
      path: '/b',
      headers: json,
      body: '{"\\u005f_proto__":{"isAdmin":true},"\\u0063onstructor":{"x":1},"caf\\u00e9":1}',
    });
    assert.deepEqual(res.json(), { body: { 'caf\u00e9': 1 }, ownProto: false });
  });

  it('keeps urlencoded fields that only contain "prototype" or "constructor"', async () => {
    const res = await send(port, {
      method: 'POST',
      path: '/b',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'prototypeUrl=x&constructorId=1&constructor=2&__proto__=3&keep=4',
    });
    assert.deepEqual(res.json().body, { prototypeUrl: 'x', constructorId: '1', keep: '4' });
  });
});
