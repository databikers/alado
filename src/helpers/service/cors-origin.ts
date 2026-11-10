import { CorsOptions } from '@options';

function allowedOrigins(cors: CorsOptions): string[] {
  return Array.isArray(cors.allowedOrigin) ? cors.allowedOrigin : [cors.allowedOrigin || '*'];
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
 */
export function corsAllowOrigin(cors: CorsOptions, origin: string | undefined): string | undefined {
  if (typeof cors.allowedOrigin === 'string' && cors.allowedOrigin !== '*') {
    return cors.allowedOrigin;
  }
  const allowed: string[] = allowedOrigins(cors);
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
 * Whether the answer depends on the Origin header: a list naming origins, or '*' with credentials
 * (the request's Origin is sent back). Without Vary, a shared cache would hand one origin's response
 * to another.
 */
export function corsVariesByOrigin(cors: CorsOptions): boolean {
  const allowed: string[] = allowedOrigins(cors);
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
