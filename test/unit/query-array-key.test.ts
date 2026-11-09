import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { queryParser } from '../../src/helpers/parser/query-parser';

describe('queryParser array keys', () => {
  it('checks a long key in linear time', () => {
    // 3.5.12 tested /\w+\[\]$/, quadratic: ~200 ms for a key at the 16 KB header limit
    const key = 'a'.repeat(200000);
    const started = Date.now();
    queryParser(`${key}=1&${key}[]=2`);
    const ms = Date.now() - started;
    assert.ok(ms < 200, `took ${ms} ms`);
  });

  it('keeps the name[] rules', () => {
    assert.deepEqual(queryParser('a[]=1&a[]=2&b_1[]=3&[]=4&-[]=5&c=6&c=7&__proto__[]=8'), {
      a: [
        '1',
        '2',
      ],
      b_1: ['3'],
      '[]': '4',
      '-[]': '5',
      c: [
        '6',
        '7',
      ],
    });
  });
});

describe('queryParser mixing `a` and `a[]`', () => {
  it('keeps every value, in order', () => {
    assert.deepEqual(queryParser('a=1&a[]=2'), {
      a: [
        '1',
        '2',
      ],
    });
    assert.deepEqual(queryParser('a[]=1&a=2'), {
      a: [
        '1',
        '2',
      ],
    });
    assert.deepEqual(queryParser('a=1&a=2&a[]=3'), {
      a: [
        '1',
        '2',
        '3',
      ],
    });
  });

  it('does not take inherited names as earlier values', () => {
    assert.deepEqual(queryParser('toString[]=x&hasOwnProperty[]=y'), { toString: ['x'], hasOwnProperty: ['y'] });
  });
});
