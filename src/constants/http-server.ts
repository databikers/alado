export const defaultHost: string = '0.0.0.0';
export const defaultBacklog: number = 2048;
export const defaultMaxBodySizeBytes: number = 1024 * 1024;
// parts one multipart body may hold (parsing.maxParts)
export const defaultMaxMultipartParts: number = 1000;

// request headers browsers may send cross-origin when cors.allowedHeaders is left out: the two every
// JSON API call needs (Content-Type: application/json and Authorization both require a preflight)
export const defaultCorsAllowedHeaders: readonly string[] = [
  'Content-Type',
  'Authorization',
];
