import { SecureContextOptions } from 'tls';
import http, { IncomingMessage, Server, ServerOptions, ServerResponse } from 'http';
import https from 'https';
import { RequestProcessorOptions } from '@options';
import { RequestProcessor } from '@request-processor';

function verifySecureContextOptions(options: SecureContextOptions & ServerOptions): boolean {
  return options && typeof options === 'object' && Boolean(Object.keys(options).length);
}

export function httpServerFactory(
  requestProcessorOptions: RequestProcessorOptions,
  options?: SecureContextOptions & ServerOptions,
): Server<typeof IncomingMessage, typeof ServerResponse> {
  const requestProcessor: RequestProcessor = new RequestProcessor(requestProcessorOptions);
  const handler = requestProcessor.process.bind(requestProcessor);
  return verifySecureContextOptions(options as SecureContextOptions & ServerOptions)
    ? https.createServer(options as SecureContextOptions & ServerOptions, handler)
    : (http.createServer(handler) as Server<typeof IncomingMessage, typeof ServerResponse>);
}
