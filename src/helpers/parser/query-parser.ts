import { AladoServerError } from '@dto';

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
    throw Object.assign(new Error('Malformed query string'), { statusCode: 400 } as AladoServerError);
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
    if (/\w+\[\]$/.test(key)) {
      const k: string = key.replace(/\[\]$/, '');
      if (unsafeKeys.has(k)) {
        continue;
      }
      query[k] = Array.isArray(query[k]) ? query[k] : [];
      query[k].push(value);
    } else if (unsafeKeys.has(key)) {
      continue;
    } else if (Object.prototype.hasOwnProperty.call(query, key)) {
      if (!Array.isArray(query[key])) {
        query[key] = [query[key]];
      }
      query[key].push(value);
    } else {
      query[key] = value;
    }
  }
  return query;
}
