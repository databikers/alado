import { defaultHeaders } from '@const';

export function mergeHeaders(headers?: Record<string, string>) {
  if (!headers || typeof headers !== 'object') {
    return defaultHeaders;
  }
  for (const header in headers) {
    headers[header] = headers[header].toString();
  }
  return { ...defaultHeaders, ...headers };
}
