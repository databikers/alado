export const defaultHost: string = '0.0.0.0';
export const defaultBacklog: number = 2048;
export const defaultMaxBodySizeBytes: number = 1024 * 1024;
// parts one multipart body may hold (parsing.maxParts)
export const defaultMaxMultipartParts: number = 1000;
// how long a handler may take to answer (handlerTimeoutMs): a handler that never answers must not
// hold its connection and memory for good
export const defaultHandlerTimeoutMs: number = 60_000;

// request headers browsers may send cross-origin when cors.allowedHeaders is left out: the two every
// JSON API call needs (Content-Type: application/json and Authorization both require a preflight)
export const defaultCorsAllowedHeaders: readonly string[] = [
  'Content-Type',
  'Authorization',
];
