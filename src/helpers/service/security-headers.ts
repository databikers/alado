import { validateHeaderName, validateHeaderValue } from 'http';
import { SecurityHeadersOption } from '@options';

/**
 * Headers sent on every response with `securityHeaders: true`. They suit an API: the browser keeps
 * to HTTPS (ignored over plain HTTP, so harmless behind a TLS proxy), sends no referrer, and never
 * shows a response inside a frame. A Content-Security-Policy beyond frame-ancestors depends on what
 * a page loads, so it is left to the application.
 */
export const securityHeaderPreset: Readonly<Record<string, string>> = Object.freeze({
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'",
});

/**
 * The headers of a securityHeaders option: none for false or undefined, the preset for true, and
 * for an object the preset with its entries applied (names in any letter case; a string replaces or
 * adds a header, false removes one of the preset).
 */
export function resolveSecurityHeaders(option: SecurityHeadersOption | undefined): Record<string, string> {
  if (!option) {
    return {};
  }
  const headers: Record<string, string> = { ...securityHeaderPreset };
  if (option === true) {
    return headers;
  }
  for (const [
    name,
    value,
  ] of Object.entries(option)) {
    for (const known of Object.keys(headers)) {
      if (known.toLowerCase() === name.toLowerCase()) {
        delete headers[known];
      }
    }
    if (value !== false) {
      headers[name] = value;
    }
  }
  return headers;
}

// throws for a value that is not true/false or an object of valid header names and string/false values
export function validateSecurityHeaders(option: unknown) {
  if (option === undefined || typeof option === 'boolean') {
    return;
  }
  if (!option || typeof option !== 'object' || Array.isArray(option)) {
    throw new Error('AladoServerOptions.securityHeaders should be true, false or an object of header values');
  }
  for (const [
    name,
    value,
  ] of Object.entries(option)) {
    if (value !== false && typeof value !== 'string') {
      throw new Error(`AladoServerOptions.securityHeaders["${name}"] should be a string, or false to leave it out`);
    }
    try {
      validateHeaderName(name);
      if (typeof value === 'string') {
        validateHeaderValue(name, value);
      }
    } catch (e) {
      throw new Error(`AladoServerOptions.securityHeaders["${name}"]: ${(e as Error).message}`, { cause: e });
    }
  }
}
