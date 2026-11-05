import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer } from '../../src';
import { baseOptions, close, listen, send, sendJson } from '../helpers/http';

const json = { 'Content-Type': 'application/json' };
const anything = { handler: () => true, error: { statusCode: 400, message: 'Bad Request' } };
// isJSON + a pass-through transform: the parsed value is what the handler receives
const jsonField = { isJSON: true, validation: anything, transform: (v: unknown) => v };

let seenByValidator: unknown;
const recordingField = {
  isJSON: true,
  validation: {
    handler: (v: unknown) => {
      seenByValidator = v;
      return true;
    },
    error: { statusCode: 400, message: 'Bad Request' },
  },
};

const report = (value: any) => ({
  value,
  ownProto: Object.prototype.hasOwnProperty.call(value, '__proto__'),
  assignedIsAdmin: (Object.assign({}, value) as any).isAdmin === true,
});

let app: AladoServer;
let port: number;

before(async () => {
  app = new AladoServer(baseOptions('is-json-forbidden-keys'));
  app.post(
    '/body',
    { title: 'body', request: { body: { filter: jsonField } }, response: { statusCode: 200, body: {} } } as any,
    async (req: any) => ({ statusCode: 200, headers: json, body: report(req.body.filter) }),
  );
  app.get(
    '/query',
    { title: 'query', request: { query: { filter: jsonField } }, response: { statusCode: 200, body: {} } } as any,
    async (req: any) => ({ statusCode: 200, headers: json, body: report(req.query.filter) }),
  );
  app.post(
    '/validator',
    {
      title: 'validator',
      request: { body: { filter: recordingField } },
      response: { statusCode: 200, body: {} },
    } as any,
    async () => ({ statusCode: 200, headers: json, body: report(seenByValidator) }),
  );
  port = await listen(app);
});

after(() => close(app));

const payload = '{"__proto__":{"isAdmin":true},"\\u0063onstructor":{"x":1},"status":"active"}';
const clean = { value: { status: 'active' }, ownProto: false, assignedIsAdmin: false };

describe('isJSON fields drop forbidden keys', () => {
  it('in a JSON body field', async () => {
    const res = await sendJson(port, 'POST', '/body', { filter: payload });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json(), clean);
  });

  it('in a urlencoded body field', async () => {
    const res = await send(port, {
      method: 'POST',
      path: '/body',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `filter=${encodeURIComponent(payload)}`,
    });
    assert.deepEqual(res.json(), clean);
  });

  it('in a query parameter', async () => {
    const res = await send(port, { path: `/query?filter=${encodeURIComponent(payload)}` });
    assert.deepEqual(res.json(), clean);
  });

  it('before the value reaches the validation handler', async () => {
    const res = await sendJson(port, 'POST', '/validator', { filter: payload });
    assert.deepEqual(res.json(), clean);
  });

  it('still parses an ordinary value', async () => {
    const res = await sendJson(port, 'POST', '/body', { filter: '{"status":"active","tags":["a","b"]}' });
    assert.deepEqual(res.json().value, {
      status: 'active',
      tags: [
        'a',
        'b',
      ],
    });
  });
});
