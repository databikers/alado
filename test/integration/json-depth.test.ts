import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer } from '../../src';
import { JsonDepthError, MAX_JSON_DEPTH, jsonDepthExceeds, parseJson } from '../../src/helpers/parser/json-parser';
import { baseOptions, close, listen, send, sendJson } from '../helpers/http';

const arrays = (depth: number): string => '['.repeat(depth) + '1' + ']'.repeat(depth);
const objects = (depth: number): string => '{"a":'.repeat(depth) + '1' + '}'.repeat(depth);

describe('jsonDepthExceeds', () => {
  it(`allows ${MAX_JSON_DEPTH} levels and refuses one more`, () => {
    for (const make of [
      arrays,
      objects,
    ]) {
      assert.equal(jsonDepthExceeds(make(MAX_JSON_DEPTH)), false);
      assert.equal(jsonDepthExceeds(make(MAX_JSON_DEPTH + 1)), true);
    }
  });

  it('counts mixed arrays and objects', () => {
    const half = MAX_JSON_DEPTH / 2;
    const text = '[{"a":'.repeat(half) + '1' + '}]'.repeat(half);
    assert.equal(jsonDepthExceeds(text), false);
    assert.equal(jsonDepthExceeds('[' + text + ']'), true);
  });

  it('ignores brackets inside strings, including after escaped quotes', () => {
    assert.equal(jsonDepthExceeds(JSON.stringify({ s: '['.repeat(10000) })), false);
    assert.equal(jsonDepthExceeds(JSON.stringify({ s: '\\"[{'.repeat(5000) })), false);
    assert.equal(
      jsonDepthExceeds(
        JSON.stringify([
          '"\\',
          '['.repeat(1000),
        ]),
      ),
      false,
    );
  });

  it('measures depth, not the number of brackets', () => {
    assert.equal(jsonDepthExceeds(JSON.stringify(Array.from({ length: 20000 }, () => [{ a: [1] }]))), false);
  });
});

describe('parseJson depth limit', () => {
  it('throws JsonDepthError before parsing a deep document', () => {
    assert.throws(() => parseJson(arrays(400000)), JsonDepthError);
    assert.deepEqual(parseJson(arrays(2)), [[1]]);
  });
});

describe('deep JSON over HTTP', () => {
  const json = { 'Content-Type': 'application/json' };
  let app: AladoServer;
  let port: number;
  let fieldValue: unknown;

  before(async () => {
    app = new AladoServer(baseOptions('json-depth'));
    const open = {
      title: 'echo',
      options: { allowUnknownFields: true },
      request: {},
      response: { statusCode: 200, body: {} },
    };
    app.post('/echo', open as any, async (req: any) => ({ statusCode: 200, headers: json, body: { b: req.body } }));
    const field = {
      isJSON: true,
      validation: {
        handler: (v: unknown) => {
          fieldValue = v;
          return true;
        },
        error: { statusCode: 400, message: 'Bad Request' },
      },
    };
    app.post(
      '/field',
      { title: 'field', request: { body: { f: field } }, response: { statusCode: 200, body: {} } } as any,
      async () => ({ statusCode: 200, headers: json, body: { type: typeof fieldValue } }),
    );
    port = await listen(app);
  });

  after(() => close(app));

  it('rejects a deep body with 400 and its own message', async () => {
    for (const depth of [
      MAX_JSON_DEPTH + 1,
      400000,
    ]) {
      const res = await send(port, { method: 'POST', path: '/echo', headers: json, body: arrays(depth) });
      assert.equal(res.status, 400);
      assert.deepEqual(res.json(), { message: `Invalid JSON body: nested deeper than ${MAX_JSON_DEPTH} levels` });
    }
  });

  it(`echoes a ${MAX_JSON_DEPTH}-level body back`, async () => {
    const res = await send(port, { method: 'POST', path: '/echo', headers: json, body: arrays(MAX_JSON_DEPTH) });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json(), { b: JSON.parse(arrays(MAX_JSON_DEPTH)) });
  });

  it('keeps a too-deep isJSON field as the raw string, like any other unparseable value', async () => {
    const res = await sendJson(port, 'POST', '/field', { f: arrays(MAX_JSON_DEPTH + 1) });
    assert.deepEqual(res.json(), { type: 'string' });
    const ok = await sendJson(port, 'POST', '/field', { f: arrays(3) });
    assert.deepEqual(ok.json(), { type: 'object' });
  });

  it('still returns the generic message for invalid JSON', async () => {
    const res = await send(port, { method: 'POST', path: '/echo', headers: json, body: '{"a":' });
    assert.deepEqual(res.json(), { message: 'Invalid JSON body' });
  });
});
