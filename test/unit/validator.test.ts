import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../../src';

describe('validate: type entry points', () => {
  it('string() accepts strings only', async () => {
    const v = validate.string().build();
    assert.equal(await v('a'), true);
    assert.equal(await v(1), false);
    assert.equal(await v({}), false);
  });

  it('number() rejects NaN and numeric strings', async () => {
    const v = validate.number().build();
    assert.equal(await v(1.5), true);
    assert.equal(await v(NaN), false);
    assert.equal(await v('1'), false);
  });

  it('boolean(), array(), object()', async () => {
    assert.equal(await validate.boolean().build()(false), true);
    assert.equal(await validate.boolean().build()('true'), false);
    assert.equal(await validate.array().build()([]), true);
    assert.equal(await validate.array().build()({}), false);
    assert.equal(await validate.object().build()({}), true);
    assert.equal(await validate.object().build()([]), false);
  });
});

describe('validate: required / optional', () => {
  it('only a missing value passes when optional: null and empty strings go through the rules', async () => {
    const v = validate.string().email().build();
    assert.equal(await v(undefined), true);
    assert.equal(await v(null), false);
    assert.equal(await v(''), false);
    assert.equal(await validate.number().integer().min(18).build()(null), false);
    assert.equal(await validate.string().min(3).build()(''), false);
    // a plain string() accepts '' when optional
    assert.equal(await validate.string().build()(''), true);
  });

  it('nullable() accepts null, optional or required', async () => {
    assert.equal(await validate.number().min(18).nullable().build()(null), true);
    assert.equal(await validate.number().min(18).nullable().required().build()(null), true);
    assert.equal(await validate.number().min(18).nullable().build()(10), false);
    assert.equal(validate.string().email().nullable().buildSync()(null), true);
  });

  it('rejects null inside arrays and objects unless the item validator is nullable', async () => {
    assert.equal(
      await validate.array().items(validate.string().buildSync()).build()([
        'a',
        null,
      ]),
      false,
    );
    assert.equal(
      await validate.array().items(validate.string().nullable().buildSync()).build()([
        'a',
        null,
      ]),
      true,
    );
  });

  it('empty values fail when required', async () => {
    const v = validate.string().email().required().build();
    assert.equal(await v(undefined), false);
    assert.equal(await v(null), false);
    assert.equal(await v(''), false);
  });

  it('optional() undoes required()', async () => {
    const v = validate.string().required().optional().build();
    assert.equal(await v(undefined), true);
  });

  it('0 and false are not treated as empty', async () => {
    assert.equal(await validate.number().required().build()(0), true);
    assert.equal(await validate.boolean().required().build()(false), true);
  });
});

describe('validate: string rules', () => {
  it('min / max / length', async () => {
    const v = validate.string().min(2).max(4).build();
    assert.equal(await v('a'), false);
    assert.equal(await v('ab'), true);
    assert.equal(await v('abcd'), true);
    assert.equal(await v('abcde'), false);
    assert.equal(await validate.string().length(3).build()('abc'), true);
    assert.equal(await validate.string().length(3).build()('ab'), false);
  });

  it('regex', async () => {
    const v = validate
      .string()
      .regex(/^[a-z_]+$/)
      .build();
    assert.equal(await v('ok_name'), true);
    assert.equal(await v('Not OK'), false);
  });

  it('regex gives the same answer on every call for /g and /y patterns', async () => {
    for (const pattern of [
      /^[a-z_]+$/g,
      /[a-z]+/y,
      /^[A-Z_]+$/gi,
    ]) {
      const v = validate.string().regex(pattern).buildSync();
      assert.deepEqual(
        [
          v('ok_name'),
          v('ok_name'),
          v('ok_name'),
        ],
        [
          true,
          true,
          true,
        ],
        String(pattern),
      );
      assert.equal(v('NOT OK!'), false);
      assert.equal(pattern.lastIndex, 0);
    }
  });

  it('email', async () => {
    const v = validate.string().email().build();
    assert.equal(await v('user@example.com'), true);
    assert.equal(await v('user@example'), false);
    assert.equal(await v('user example.com'), false);
    assert.equal(await v('first.last+tag@mail.example.co.uk'), true);
    assert.equal(await v('user@.example.com'), false);
    assert.equal(await v('user@example..com'), false);
    assert.equal(await v('user@example.com.'), false);
  });

  it('email rejects addresses longer than 254 characters', async () => {
    const v = validate.string().email().build();
    const domain = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.com`;
    assert.equal(await v(`${'x'.repeat(254 - domain.length - 1)}@${domain}`), true);
    assert.equal(await v(`${'x'.repeat(255 - domain.length - 1)}@${domain}`), false);
  });

  it('email runs in linear time on hostile input', () => {
    const v = validate.string().email().buildSync();
    // 3.3.0 needed ~4 s for this input (quadratic backtracking)
    const hostile = `a@${'.'.repeat(80000)}@`;
    const started = Date.now();
    assert.equal(v(hostile), false);
    // without the length cap the pattern alone must still be fast
    assert.equal(/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(hostile), false);
    assert.equal(/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(`a@${'a.'.repeat(80000)}`), false);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 200, `took ${elapsed} ms`);
  });

  it('uuid', async () => {
    const v = validate.string().uuid().build();
    assert.equal(await v('123e4567-e89b-12d3-a456-426614174000'), true);
    assert.equal(await v('123e4567e89b12d3a456426614174000'), false);
  });

  it('objectId', async () => {
    const v = validate.string().objectId().build();
    assert.equal(await v('507f1f77bcf86cd799439011'), true);
    assert.equal(await v('507f1f77bcf86cd79943901'), false);
    assert.equal(await v('zzzf1f77bcf86cd799439011'), false);
  });

  it('url', async () => {
    const v = validate.string().url().build();
    assert.equal(await v('https://alado.tech/docs'), true);
    assert.equal(await v('not a url'), false);
  });

  it('url accepts only http and https by default', async () => {
    const v = validate.string().url().build();
    assert.equal(await v('HTTP://alado.tech'), true);
    assert.equal(await v('javascript:alert(1)'), false);
    assert.equal(await v('data:text/html,<script>alert(1)</script>'), false);
    assert.equal(await v('file:///etc/passwd'), false);
  });

  it('url takes the allowed protocols', async () => {
    const v = validate
      .string()
      .url([
        'https',
        'mailto:',
      ])
      .build();
    assert.equal(await v('mailto:team@alado.tech'), true);
    assert.equal(await v('https://alado.tech'), true);
    assert.equal(await v('http://alado.tech'), false);
  });

  it('url rejects values that are not strings', async () => {
    const v = validate
      .custom(() => true)
      .url()
      .build();
    assert.equal(await v({ toString: () => 'https://alado.tech' }), false);
  });

  it('trim rejects surrounding whitespace', async () => {
    const v = validate.string().trim().build();
    assert.equal(await v('abc'), true);
    assert.equal(await v(' abc '), false);
  });
});

describe('validate: number rules', () => {
  it('min / max apply to the numeric value', async () => {
    const v = validate.number().min(18).max(120).build();
    assert.equal(await v(17), false);
    assert.equal(await v(18), true);
    assert.equal(await v(121), false);
  });

  it('integer / positive / negative', async () => {
    assert.equal(await validate.number().integer().build()(2), true);
    assert.equal(await validate.number().integer().build()(2.5), false);
    assert.equal(await validate.number().positive().build()(1), true);
    assert.equal(await validate.number().positive().build()(0), false);
    assert.equal(await validate.number().negative().build()(-1), true);
    assert.equal(await validate.number().negative().build()(0), false);
  });
});

describe('validate: generic rules', () => {
  it('enum', async () => {
    const v = validate.string().enum('admin', 'user').build();
    assert.equal(await v('admin'), true);
    assert.equal(await v('root'), false);
  });

  it('custom supports async functions', async () => {
    const v = validate
      .string()
      .custom(async (x) => x === 'yes')
      .build();
    assert.equal(await v('yes'), true);
    assert.equal(await v('no'), false);
  });

  it('stops at the first failing rule', async () => {
    let called = false;
    const v = validate
      .string()
      .min(10)
      .custom(() => {
        called = true;
        return true;
      })
      .build();
    assert.equal(await v('short'), false);
    assert.equal(called, false);
  });
});

describe('validate: object rules', () => {
  it('shape validates every key', async () => {
    const v = validate
      .object()
      .shape({
        email: validate.string().email().required().build(),
        age: validate.number().integer().build(),
      })
      .build();
    assert.equal(await v({ email: 'a@b.co', age: 30 }), true);
    assert.equal(await v({ email: 'a@b.co' }), true);
    assert.equal(await v({ email: 'nope', age: 30 }), false);
    assert.equal(await v({ age: 30 }), false);
    assert.equal(await v([]), false);
  });

  it('minKeys / maxKeys', async () => {
    assert.equal(await validate.object().minKeys(2).build()({ a: 1 }), false);
    assert.equal(await validate.object().minKeys(2).build()({ a: 1, b: 2 }), true);
    assert.equal(await validate.object().maxKeys(1).build()({ a: 1, b: 2 }), false);
  });

  it('or requires at least one non-empty key', async () => {
    const v = validate.object().or('email', 'phone').build();
    assert.equal(await v({ email: 'a@b.co' }), true);
    assert.equal(await v({ email: '', phone: null }), false);
  });

  it('xor requires exactly one non-empty key', async () => {
    const v = validate.object().xor('email', 'phone').build();
    assert.equal(await v({ email: 'a@b.co' }), true);
    assert.equal(await v({ email: 'a@b.co', phone: '+1' }), false);
    assert.equal(await v({}), false);
  });

  it('when applies then/otherwise based on a sibling key', async () => {
    const v = validate
      .object()
      .shape({
        type: validate.string().required().build(),
        contact: validate
          .string()
          .when(
            'type',
            'email',
            validate.string().email().build(),
            validate
              .string()
              .regex(/^\+\d+$/)
              .build(),
          )
          .build(),
      })
      .build();
    assert.equal(await v({ type: 'email', contact: 'a@b.co' }), true);
    assert.equal(await v({ type: 'email', contact: '+123' }), false);
    assert.equal(await v({ type: 'phone', contact: '+123' }), true);
    assert.equal(await v({ type: 'phone', contact: 'a@b.co' }), false);
  });

  it('when accepts an array of matching values', async () => {
    const v = validate
      .object()
      .shape({
        role: validate.string().build(),
        level: validate
          .number()
          .when(
            'role',
            [
              'admin',
              'owner',
            ],
            validate.number().min(10).build(),
          )
          .build(),
      })
      .build();
    assert.equal(await v({ role: 'owner', level: 5 }), false);
    assert.equal(await v({ role: 'user', level: 5 }), true);
  });

  it('match picks a case by sibling value and falls back', async () => {
    const v = validate
      .object()
      .shape({
        status: validate.string().build(),
        reason: validate
          .string()
          .match('status', { banned: validate.string().min(5).required().build() }, validate.string().max(0).build())
          .build(),
      })
      .build();
    assert.equal(await v({ status: 'banned', reason: 'spamming' }), true);
    assert.equal(await v({ status: 'banned', reason: 'no' }), false);
    assert.equal(await v({ status: 'active', reason: 'x' }), false);
  });

  it('match does not resolve case keys through Object.prototype', async () => {
    const v = validate
      .object()
      .shape({
        status: validate.string().build(),
        reason: validate
          .string()
          .match('status', { banned: validate.string().min(5).build() }, () => false)
          .build(),
      })
      .build();
    for (const status of [
      'constructor',
      'toString',
      'hasOwnProperty',
      '__proto__',
      'valueOf',
    ]) {
      assert.equal(await v({ status, reason: 'x' }), false, status);
    }
  });

  it('match without a fallback passes inherited-looking keys instead of calling Object.prototype', async () => {
    const v = validate
      .object()
      .shape({
        status: validate.string().build(),
        reason: validate
          .string()
          .match('status', { banned: () => false })
          .build(),
      })
      .build();
    assert.equal(await v({ status: 'constructor', reason: 'x' }), true);
    assert.equal(await v({ status: 'banned', reason: 'x' }), false);
  });
});

describe('validate: array rules', () => {
  it('items validates each element', async () => {
    const v = validate.array().items(validate.number().integer().build()).build();
    assert.equal(
      await v([
        1,
        2,
        3,
      ]),
      true,
    );
    assert.equal(
      await v([
        1,
        2.5,
      ]),
      false,
    );
  });

  it('minItems / maxItems / unique', async () => {
    assert.equal(await validate.array().minItems(2).build()([1]), false);
    assert.equal(
      await validate.array().maxItems(1).build()([
        1,
        2,
      ]),
      false,
    );
    assert.equal(
      await validate.array().unique().build()([
        1,
        2,
      ]),
      true,
    );
    assert.equal(
      await validate.array().unique().build()([
        1,
        1,
      ]),
      false,
    );
  });
});

describe('validate: README contract', () => {
  it('build() returns a reusable async function', async () => {
    const v = validate.string().build();
    const r = v('x');
    assert.ok(r instanceof Promise);
    assert.equal(await r, true);
    assert.equal(await v('y'), true);
  });

  it('buildSync() returns a plain boolean, as in the README example', () => {
    const isValidName = validate.string().min(2).max(50).buildSync();
    const r = isValidName('Pablo');
    assert.equal(r, true);
    assert.equal(typeof r, 'boolean');
    assert.equal(isValidName('P'), false);
  });
});

describe('validate: buildSync', () => {
  it('applies the same required/optional semantics as build()', () => {
    assert.equal(validate.string().email().buildSync()(undefined), true);
    assert.equal(validate.string().email().buildSync()(''), false);
    assert.equal(validate.string().email().buildSync()(null), false);
    assert.equal(validate.string().email().required().buildSync()(''), false);
    assert.equal(validate.number().required().buildSync()(0), true);
  });

  it('agrees with build() on every sync rule', async () => {
    const chains = [
      () => validate.string().email(),
      () => validate.string().uuid(),
      () => validate.number().integer().min(1).max(10),
      () => validate.string().enum('a', 'b'),
      () => validate.array().minItems(1).unique(),
      () => validate.object().xor('email', 'phone'),
    ];
    const inputs = [
      'a@b.co',
      'x',
      5,
      11,
      'a',
      [1],
      [
        1,
        1,
      ],
      { email: 'x' },
      { email: 'x', phone: 'y' },
      {},
    ];
    for (const chain of chains) {
      const async = chain().build();
      const sync = chain().buildSync();
      for (const input of inputs) {
        assert.equal(sync(input), await async(input), `${chain} on ${JSON.stringify(input)}`);
      }
    }
  });

  it('composes with nested buildSync() validators in shape() and items()', () => {
    const v = validate
      .object()
      .shape({
        email: validate.string().email().required().buildSync(),
        tags: validate.array().items(validate.string().min(2).required().buildSync()).buildSync(),
      })
      .buildSync();
    assert.equal(v({ email: 'a@b.co', tags: ['xy'] }), true);
    assert.equal(v({ email: 'a@b.co', tags: ['x'] }), false);
    assert.equal(v({ tags: ['xy'] }), false);
  });

  it('supports when() with sync branches', () => {
    const v = validate
      .object()
      .shape({
        type: validate.string().buildSync(),
        contact: validate.string().when('type', 'email', validate.string().email().buildSync()).buildSync(),
      })
      .buildSync();
    assert.equal(v({ type: 'email', contact: 'a@b.co' }), true);
    assert.equal(v({ type: 'email', contact: 'nope' }), false);
  });

  it('throws when building with an async custom rule', () => {
    assert.throws(
      () =>
        validate
          .string()
          .custom(async () => true)
          .buildSync(),
      { message: 'Validator contains async rules — use .build() instead of .buildSync()' },
    );
  });

  it('throws at call time when a rule returns a Promise', () => {
    const lookup = validate.custom((v) => Promise.resolve(v === 'a@b.co')).build();
    const v = validate.object().shape({ email: lookup }).buildSync();
    assert.throws(() => v({ email: 'a@b.co' }), /use \.build\(\) instead of \.buildSync\(\)/);
  });

  it('accepts a nested build() validator whose rules are all synchronous', () => {
    const v = validate.object().shape({ email: validate.string().email().build() }).buildSync();
    assert.equal(v({ email: 'a@b.co' }), true);
    assert.equal(v({ email: 'nope' }), false);
  });

  it('does not throw for an async chain when the input is empty', () => {
    // nothing runs for empty input, same as build()
    const v = validate.object().shape({ email: validate.string().email().build() }).buildSync();
    assert.equal(v(undefined), true);
  });

  it('build() still works after shape()/items() became sync-capable', async () => {
    const v = validate.object().shape({ email: validate.string().email().required().build() }).build();
    assert.equal(await v({ email: 'a@b.co' }), true);
    assert.equal(await v({ email: 'nope' }), false);
    const arr = validate.array().items(validate.number().build()).build();
    assert.equal(
      await arr([
        1,
        2,
      ]),
      true,
    );
    assert.equal(
      await arr([
        1,
        'x',
      ]),
      false,
    );
  });

  it('works as a @validateProperty handler', async () => {
    // handler may return boolean | Promise<boolean>; a plain boolean must be accepted
    const handler = validate.string().min(3).buildSync();
    assert.equal(await Promise.resolve(handler('abcd')), true);
  });
});

describe('items() and shape() with validators from build()', () => {
  it('validate a large array without a promise per item', async () => {
    const list = validate.array().items(validate.number().build()).build();
    const items = new Array(300000).fill(1);
    global.gc?.();
    const before = process.memoryUsage().heapUsed;
    assert.equal(await list(items), true);
    const grown = (process.memoryUsage().heapUsed - before) / 1048576;
    assert.ok(grown < 40, `heap grew by ${grown.toFixed(0)} MB`);
    assert.equal(
      await list([
        ...items,
        'x',
      ]),
      false,
    );
  });

  it('stop at the first item that fails', async () => {
    let calls = 0;
    const item = validate
      .custom((v) => {
        calls++;
        return v !== 'bad';
      })
      .build();
    assert.equal(
      await validate.array().items(item).build()([
        'a',
        'bad',
        'c',
        'd',
      ]),
      false,
    );
    assert.equal(calls, 2);
  });

  it('still await async rules, in order', async () => {
    const seen: number[] = [];
    const item = validate
      .custom(async (v) => {
        await new Promise((r) => setTimeout(r, v === 1 ? 5 : 0));
        seen.push(v);
        return v < 3;
      })
      .build();
    const list = validate.array().items(item).build();
    assert.equal(
      await list([
        1,
        2,
      ]),
      true,
    );
    assert.deepEqual(
      seen,
      [
        1,
        2,
      ],
    );
    assert.equal(
      await list([
        1,
        3,
        2,
      ]),
      false,
    );
    const nested = validate
      .object()
      .shape({ tags: validate.array().items(validate.string().build()).build() })
      .build();
    assert.equal(
      await nested({
        tags: [
          'a',
          'b',
        ],
      }),
      true,
    );
    assert.equal(
      await nested({
        tags: [
          'a',
          1,
        ],
      }),
      false,
    );
  });

  it('keep optional, required and nullable for items', async () => {
    assert.equal(
      await validate.array().items(validate.string().nullable().build()).build()([
        'a',
        null,
      ]),
      true,
    );
    assert.equal(
      await validate.array().items(validate.string().build()).build()([
        'a',
        null,
      ]),
      false,
    );
    assert.equal(
      await validate.array().items(validate.string().required().build()).build()([
        'a',
        '',
      ]),
      false,
    );
  });
});
