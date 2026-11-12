import { AccessControlConfig, AladoConfigurationError, Context } from '@dto';
import { mapAuth } from './auth-alternatives';

const HEADERS_PREFIX: string = 'headers.';

function lowerHeaderPath<T>(path: T): T {
  return typeof path === 'string' && path.startsWith(HEADERS_PREFIX)
    ? (`${HEADERS_PREFIX}${path.slice(HEADERS_PREFIX.length).toLowerCase()}` as T)
    : path;
}

/**
 * Node gives request header names in lower case, so a header declared as `X-Api-Key` (in the request
 * DTO, or as `headers.X-Api-Key` in the auth input or an access-control rule) would never be found:
 * a required header always failing, an optional one never validated while the handler still reads it.
 * Done once when the route is registered, after the OpenAPI document keeps the declared spelling.
 * The auth strategies and rule objects are copied, not changed: one config object is often shared by
 * routes.
 */
export function normalizeHeaderNames(context: Context<any>): void {
  const declared: Record<string, any> | undefined = context.request?.headers as Record<string, any> | undefined;
  if (declared) {
    const lowered: Record<string, any> = {};
    for (const name in declared) {
      const lower: string = name.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(lowered, lower)) {
        throw new AladoConfigurationError(
          'HEADER_DECLARED_TWICE',
          `Request header "${name}" is declared twice (header names are case-insensitive)`,
        );
      }
      lowered[lower] = declared[name];
    }
    (context.request as any).headers = lowered;
  }
  if (context.auth) {
    context.auth = mapAuth(context.auth, (auth) => ({ ...auth, inputProperty: lowerHeaderPath(auth.inputProperty) }));
  }
  if (Array.isArray(context.accessControl)) {
    context.accessControl = context.accessControl.map((rule: AccessControlConfig<any>) => ({
      ...rule,
      inputProperty: lowerHeaderPath(rule.inputProperty),
      compareWithProperty: lowerHeaderPath(rule.compareWithProperty),
    }));
  }
}
