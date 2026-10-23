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
  it('empty values pass when optional', async () => {
    const v = validate.string().email().build();
    assert.equal(await v(undefined), true);
    assert.equal(await v(null), true);
    assert.equal(await v(''), true);
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

  it('email', async () => {
    const v = validate.string().email().build();
    assert.equal(await v('user@example.com'), true);
    assert.equal(await v('user@example'), false);
    assert.equal(await v('user example.com'), false);
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
    assert.equal(validate.string().email().buildSync()(''), true);
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
    const v = validate.object().shape({ email: validate.string().email().build() }).buildSync();
    assert.throws(() => v({ email: 'a@b.co' }), /use \.build\(\) instead of \.buildSync\(\)/);
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
