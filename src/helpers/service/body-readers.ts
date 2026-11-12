import { HttpMethod } from '@const';
import { Context } from '@dto';
import { authStrategies } from './auth-alternatives';

// methods whose request body is read: RFC 9110 defines no meaning for a GET, HEAD, DELETE or OPTIONS body
export const bodyMethods: ReadonlySet<string> = new Set<string>([
  HttpMethod.PUT,
  HttpMethod.PATCH,
  HttpMethod.POST,
  HttpMethod.QUERY,
]);

const bodyPathRegExp: RegExp = /^(body|rawBody|files)(\.|\[|$)/;

/**
 * Everything a route declares that needs the request body: body and files DTO fields, an auth or
 * access-control property read from body, rawBody or files, and options.rawBody. Empty when the
 * route never reads it.
 */
export function bodyReaders(context: Context<any>): string[] {
  const readers: string[] = [];
  if (context.options?.rawBody) {
    readers.push('options.rawBody');
  }
  for (const name in context.request?.body) {
    readers.push(`body.${name}`);
  }
  for (const name in context.request?.files) {
    readers.push(`files.${name}`);
  }
  const paths: unknown[] = [
    ...authStrategies(context.auth).map((auth) => auth.inputProperty),
    ...(context.accessControl || []).flatMap((rule) => [
      rule.inputProperty,
      rule.compareWithProperty,
    ]),
  ];
  for (const path of paths) {
    if (typeof path === 'string' && bodyPathRegExp.test(path) && !readers.includes(path)) {
      readers.push(path);
    }
  }
  return readers;
}
