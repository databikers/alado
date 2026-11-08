import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseBigInt, parseNumber, toNumericInput } from '../../src/helpers/validate/built-in/numeric-input';
import { validate } from '../../src';

describe('parseNumber', () => {
  it('reads every number format', () => {
    const cases: Array<
      [
        string,
        number,
      ]
    > = [
      [
        '42',
        42,
      ],
      [
        '-42',
        -42,
      ],
      [
        '+3.5',
        3.5,
      ],
      [
        '.5',
        0.5,
      ],
      [
        '5.',
        5,
      ],
      [
        '-0',
        -0,
      ],
      [
        '1e3',
        1000,
      ],
      [
        '-1.5E-2',
        -0.015,
      ],
      [
        '1e20',
        1e20,
      ],
      [
        '0x1F',
        31,
      ],
      [
        '-0x10',
        -16,
      ],
      [
        '0o17',
        15,
      ],
      [
        '0B101',
        5,
      ],
      [
        '1_000_000',
        1000000,
      ],
      [
        '0xff_ff',
        65535,
      ],
      [
        '9007199254740991',
        Number.MAX_SAFE_INTEGER,
      ],
      [
        '-9007199254740991',
        Number.MIN_SAFE_INTEGER,
      ],
    ];
    for (const [
      text,
      value,
    ] of cases) {
      assert.equal(parseNumber(text), value, text);
    }
  });

  it('refuses text that is not exactly a number', () => {
    for (const text of [
      '',
      ' 1',
      '1 ',
      '1_',
      '_1',
      '1__0',
      '0x',
      '0x_1',
      '1e',
      '.',
      '+',
      '--1',
      '+-1',
      '12abc',
      '1n',
      'Infinity',
      '-Infinity',
      'NaN',
      '1e400',
      '0x1g',
      '0o8',
      '0b2',
      '1'.repeat(2000),
    ]) {
      assert.equal(parseNumber(text), undefined, JSON.stringify(text.slice(0, 20)));
    }
  });

  it('refuses integers a number cannot hold exactly', () => {
    assert.equal(parseNumber('9007199254740993'), undefined);
    assert.equal(parseNumber('0x20000000000001'), undefined);
  });
});

describe('parseBigInt', () => {
  it('reads integers in every base, with or without the n suffix', () => {
    const cases: Array<
      [
        string,
        bigint,
      ]
    > = [
      [
        '9007199254740993',
        9007199254740993n,
      ],
      [
        '-12',
        -12n,
      ],
      [
        '-12n',
        -12n,
      ],
      [
        '0xffn',
        255n,
      ],
      [
        '-0b11',
        -3n,
      ],
      [
        '0o777',
        511n,
      ],
      [
        '1_000n',
        1000n,
      ],
      [
        '123456789012345678901234567890',
        123456789012345678901234567890n,
      ],
    ];
    for (const [
      text,
      value,
    ] of cases) {
      assert.equal(parseBigInt(text), value, text);
    }
  });

  it('refuses anything but an integer', () => {
    for (const text of [
      '',
      'n',
      '1.5',
      '1e3',
      '0x',
      ' 1',
      '1nn',
      '-',
    ]) {
      assert.equal(parseBigInt(text), undefined, text);
    }
  });
});

describe('numeric validators', () => {
  it('carry their input type, other validators do not', () => {
    assert.equal(toNumericInput('number', '7'), 7);
    const marker = Symbol.for('alado.numericInput');
    assert.equal((validate.number().integer().build() as any)[marker], 'number');
    assert.equal((validate.bigint().positive().buildSync() as any)[marker], 'bigint');
    assert.equal((validate.string().build() as any)[marker], undefined);
  });

  it('apply min, max, positive, negative and integer to bigints', async () => {
    const v = validate.bigint().integer().positive().min(10).max(20).build();
    assert.equal(await v(15n), true);
    assert.equal(await v(25n), false);
    assert.equal(await v(5n), false);
    assert.equal(await validate.bigint().negative().build()(-1n), true);
    assert.equal(await validate.bigint().build()(1), false);
  });
});
