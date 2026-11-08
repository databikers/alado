/**
 * Query and path values are always strings. A validator built from validate.number() or
 * validate.bigint() carries this marker, and such a value is converted before it is validated.
 */
export const numericInput: unique symbol = Symbol.for('alado.numericInput');

export type NumericInputType = 'number' | 'bigint';

// digit groups may be separated by single underscores, as in JavaScript literals: 1_000_000
const decimal: RegExp = /^[+-]?(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?$/;
const decimalInteger: RegExp = /^[+-]?\d(?:_?\d)*$/;
const radix: RegExp =
  /^([+-]?)0(?:([xX])([0-9a-fA-F](?:_?[0-9a-fA-F])*)|([oO])([0-7](?:_?[0-7])*)|([bB])([01](?:_?[01])*))$/;

// longest accepted text: no number needs more, and it keeps BigInt() of a huge string cheap
const MAX_LENGTH: number = 1024;

/** Signed integer literal in any base (decimal, 0x, 0o, 0b; "n" suffix allowed), or undefined. */
function parseIntegerLiteral(text: string): bigint | undefined {
  if (decimalInteger.test(text)) {
    return BigInt(text.replace(/_/g, ''));
  }
  const match: RegExpExecArray | null = radix.exec(text);
  if (!match) {
    return undefined;
  }
  const prefix: string = match[2] ? '0x' : match[4] ? '0o' : '0b';
  const digits: string = (match[3] || match[5] || match[7]).replace(/_/g, '');
  const value: bigint = BigInt(`${prefix}${digits}`);
  return match[1] === '-' ? -value : value;
}

/**
 * A number written as a string: decimal (with sign, fraction, exponent), 0x / 0o / 0b, digit
 * separators. Refused (undefined): empty or padded text, anything else Number() would turn into
 * 0 or NaN, values out of range (Infinity), and integers past Number.MAX_SAFE_INTEGER, whose
 * digits a number cannot keep: those are bigints.
 */
export function parseNumber(text: string): number | undefined {
  if (!text || text.length > MAX_LENGTH) {
    return undefined;
  }
  if (decimal.test(text)) {
    const value: number = Number(text.replace(/_/g, ''));
    if (!Number.isFinite(value)) {
      return undefined;
    }
    if (decimalInteger.test(text) && !Number.isSafeInteger(value)) {
      return undefined;
    }
    return value;
  }
  const integer: bigint | undefined = parseIntegerLiteral(text);
  if (integer === undefined) {
    return undefined;
  }
  const value: number = Number(integer);
  return Number.isSafeInteger(value) ? value : undefined;
}

/** An integer written as a string, any base, optional "n" suffix (123n, 0xffn), as a bigint. */
export function parseBigInt(text: string): bigint | undefined {
  if (!text || text.length > MAX_LENGTH) {
    return undefined;
  }
  return parseIntegerLiteral(text.endsWith('n') ? text.slice(0, -1) : text);
}

/** The value a numeric validator should see, or the original value when it is not convertible. */
export function toNumericInput(type: NumericInputType, value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const parsed: number | bigint | undefined = type === 'number' ? parseNumber(value) : parseBigInt(value);
  return parsed === undefined ? value : parsed;
}
