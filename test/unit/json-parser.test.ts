import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseJson } from '../../src/helpers/parser/json-parser';
import { deprecatedJsonPropertiesRegExp } from '../../src/constants';

// what the body parser did before: a reviver dropping every forbidden key
const withReviver = (text: string): unknown =>
  JSON.parse(text, (key, value) => (deprecatedJsonPropertiesRegExp.test(key) ? undefined : value));

const hasOwnProto = (value: unknown): boolean => {
  const stack: unknown[] = [value];
  while (stack.length) {
    const node: any = stack.pop();
    if (node && typeof node === 'object') {
      if (Object.prototype.hasOwnProperty.call(node, '__proto__')) {
        return true;
      }
      stack.push(...Object.values(node));
    }
  }
  return false;
};

describe('parseJson', () => {
  const cases: string[] = [
    '{"__proto__":{"isAdmin":true},"keep":1}',
    '{"\\u005f_proto__":{"isAdmin":true},"\\u0063onstructor":{"x":1},"caf\\u00e9":1}',
    '{"a":[{"constructor":1,"b":[{"prototype":2,"__proto__":{"x":1},"ok":3}]}],"prototypeUrl":"u"}',
    '{"__defineGetter__":1,"__defineSetter__":2,"constructorId":3}',
    '[{"__proto__":1},[[{"constructor":2,"k":"v"}]]]',
    '"constructor"',
    '42',
    'null',
    '{"text":"no forbidden key here, but a \\u0041 escape"}',
  ];

  it('gives the same result as the reviver it replaces', () => {
    for (const text of cases) {
      assert.deepEqual(parseJson(text), withReviver(text), text);
    }
  });

  it('leaves no own __proto__ at any depth', () => {
    for (const text of cases) {
      assert.equal(hasOwnProto(parseJson(text)), false, text);
    }
  });

  it('keeps prototypes intact', () => {
    const value: any = parseJson('{"a":{"__proto__":{"isAdmin":true}},"b":[{"__proto__":{"isAdmin":true}}]}');
    assert.equal(Object.getPrototypeOf(value.a), Object.prototype);
    assert.equal(Object.getPrototypeOf(value.b[0]), Object.prototype);
    assert.equal(value.a.isAdmin, undefined);
    assert.equal(({} as any).isAdmin, undefined);
  });

  it('walks nesting far deeper than the call stack allows', () => {
    const depth = 200000;
    const text = '{"a":'.repeat(depth) + '{"__proto__":{"isAdmin":true},"\\u006Bey":1}' + '}'.repeat(depth);
    let value: any = parseJson(text);
    for (let i = 0; i < depth; i++) {
      value = value.a;
    }
    assert.deepEqual(value, { key: 1 });
  });

  it('still throws on invalid JSON', () => {
    assert.throws(() => parseJson('{"a":'), SyntaxError);
  });
});
