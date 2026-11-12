import { CorsOptions } from '@options';

type OriginSetting = string | string[];

/**
 * `allowedOrigin` as it is for this request: a function is called (synchronously) for its current
 * value. One that throws or returns something other than a non-empty string or a list of strings
 * allows no origin; `onError` gets the reason.
 */
function originSetting(cors: CorsOptions, onError?: (error: unknown) => void): OriginSetting | undefined {
  const setting = cors.allowedOrigin;
  if (typeof setting !== 'function') {
    return setting || '*';
  }
  try {
    const value: unknown = setting();
    if (
      (typeof value === 'string' && value) ||
      (Array.isArray(value) && value.every((origin) => typeof origin === 'string' && origin))
    ) {
      return value as OriginSetting;
    }
    onError?.(new Error('AladoServerOptions.cors.allowedOrigin() should return an origin or a list of origins'));
  } catch (e) {
    onError?.(e);
  }
  return undefined;
}

function allowedOrigins(setting: OriginSetting): string[] {
  return Array.isArray(setting) ? setting : [setting];
}

/**
 * The Access-Control-Allow-Origin value for a request, or undefined when its origin is not allowed.
 * `allowedOrigin` is one origin, a list of origins, or '*' (alone or in the list) for any origin.
 * - One fixed origin (a string other than '*') is always sent as is.
 * - An origin in the list is answered with itself; another one gets no header.
 * - Any origin under '*' gets '*'. With allowedCredentials, browsers refuse '*', so the request's own
 *   Origin is sent back instead ("null", from sandboxed frames and file: pages, only when listed).
 * - A request without an Origin header (another server, curl) is not a CORS request: under '*' it
 *   gets '*', and CORS never refuses it either way.
 * - A function is asked for its current value, which is then used as above.
 */
export function corsAllowOrigin(
  cors: CorsOptions,
  origin: string | undefined,
  onError?: (error: unknown) => void,
): string | undefined {
  const setting: OriginSetting | undefined = originSetting(cors, onError);
  if (setting === undefined) {
    return undefined;
  }
  if (typeof setting === 'string' && setting !== '*') {
    return setting;
  }
  const allowed: string[] = allowedOrigins(setting);
  if (origin && allowed.includes(origin)) {
    return origin;
  }
  if (!allowed.includes('*')) {
    return undefined;
  }
  if (origin && cors.allowedCredentials) {
    return origin === 'null' ? undefined : origin;
  }
  return '*';
}

/**
 * Whether the answer depends on the Origin header: a function (its list can change), a list naming
 * origins, or '*' with credentials (the request's Origin is sent back). Without Vary, a shared cache
 * would hand one origin's response to another.
 */
export function corsVariesByOrigin(cors: CorsOptions): boolean {
  if (typeof cors.allowedOrigin === 'function') {
    return true;
  }
  const allowed: string[] = allowedOrigins(cors.allowedOrigin || '*');
  return (
    (Array.isArray(cors.allowedOrigin) && allowed.some((o: string) => o !== '*')) ||
    (allowed.includes('*') && Boolean(cors.allowedCredentials))
  );
}

/**
 * The CORS headers that do not depend on the request. Empty lists are left out instead of sent as an
 * empty header, and Access-Control-Allow-Credentials goes out only as "true" (the only value browsers
 * act on: "false" is the same as no header).
 */
export function corsStaticHeaders(cors: CorsOptions): Record<string, string> {
  const headers: Record<string, string> = {};
  if (cors.allowedHeaders?.length) {
    headers['Access-Control-Allow-Headers'] = cors.allowedHeaders.join(', ');
  }
  if (cors.exposeHeaders?.length) {
    headers['Access-Control-Expose-Headers'] = cors.exposeHeaders.join(', ');
  }
  if (cors.allowedCredentials) {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
}
