import { SecureContextOptions } from 'tls';
import http, { IncomingMessage, Server, ServerOptions, ServerResponse } from 'http';
import https from 'https';
import { RequestProcessorOptions } from '@options';
import { RequestProcessor } from '@request-processor';

function hasSecureContextOptions(ssl?: SecureContextOptions): boolean {
  return Boolean(ssl) && typeof ssl === 'object' && Object.keys(ssl as SecureContextOptions).length > 0;
}

/**
 * HTTPS is chosen by `ssl` alone: `serverOptions` (timeouts, header limits, ...) apply to either
 * server and never switch an HTTP server to HTTPS without a certificate.
 */
export function httpServerFactory(
  requestProcessorOptions: RequestProcessorOptions,
  serverOptions: ServerOptions = {},
  ssl?: SecureContextOptions,
): Server<typeof IncomingMessage, typeof ServerResponse> {
  const requestProcessor: RequestProcessor = new RequestProcessor(requestProcessorOptions);
  const handler = requestProcessor.process.bind(requestProcessor);
  return hasSecureContextOptions(ssl)
    ? https.createServer({ ...ssl, ...serverOptions }, handler)
    : (http.createServer(serverOptions, handler) as Server<typeof IncomingMessage, typeof ServerResponse>);
}
