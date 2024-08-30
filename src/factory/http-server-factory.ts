import { SecureContextOptions } from 'tls';
import http, { ServerOptions } from 'http';
import https from 'https';
import { RequestProcessorOptions } from '@options';
import { RequestProcessor } from '@request-processor';

function validateServerOptions(options: SecureContextOptions & ServerOptions): boolean {
  return options && typeof options === 'object' && Boolean(Object.keys(options).length);
}

export function httpServerFactory(
  requestProcessorOptions: RequestProcessorOptions,
  options?: SecureContextOptions & ServerOptions,
) {
  const requestProcessor: RequestProcessor = new RequestProcessor(requestProcessorOptions);
  const handler = requestProcessor.process.bind(requestProcessor);
  return validateServerOptions(options) ? https.createServer(options, handler) : http.createServer(handler);
}
