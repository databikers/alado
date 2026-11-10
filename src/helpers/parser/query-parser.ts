import { HttpError } from '@dto';

const unsafeKeys: Set<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

function decodeComponent(value: string): string {
  try {
    // query strings encode spaces as '+' (application/x-www-form-urlencoded)
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    throw new HttpError(400, 'Malformed query string');
  }
}

/**
 * `name[]`: ends with "[]" right after a word character. Same test as /\w+\[\]$/, which tried
 * every start position and backtracked over the whole key from each one: quadratic, ~200 ms for a
 * key at the 16 KB header limit.
 */
function isArrayKey(key: string): boolean {
  return key.length > 2 && key.endsWith('[]') && /\w/.test(key[key.length - 3]);
}

/**
 * Adds one decoded field to a query or form object: `key[]` and a repeated key give an array of
 * every value in order (`a=1&a[]=2` keeps both, like two `a=` keys), a single key a string. Keys
 * that would reach the prototype (__proto__, constructor, prototype) are dropped.
 */
export function appendField(target: Record<string, any>, key: string, value: string): void {
  const listed: boolean = isArrayKey(key);
  const name: string = listed ? key.slice(0, -2) : key;
  if (unsafeKeys.has(name)) {
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(target, name)) {
    target[name] = listed
      ? [
          value,
        ]
      : value;
  } else if (Array.isArray(target[name])) {
    target[name].push(value);
  } else {
    target[name] = [
      target[name],
      value,
    ];
  }
}

/**
 * Splits on '&' and the first '=' BEFORE decoding, so encoded '&' / '=' stay
 * inside values. Keys without a value are skipped (as before); `key[]` and
 * repeated keys produce arrays. Malformed percent-encoding throws a 400 error.
 */
export function queryParser(queryString: string) {
  const query: Record<string, any> = {};
  if (!queryString) {
    return query;
  }
  for (const part of queryString.split('&')) {
    const separator: number = part.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const key: string = decodeComponent(part.slice(0, separator));
    const value: string = decodeComponent(part.slice(separator + 1));
    if (!key || !value) {
      continue;
    }
    appendField(query, key, value);
  }
  return query;
}
