import { SecureContextOptions } from 'tls';
import http from 'http';
import https from 'https';
import { RequestProcessorOptions } from '@options';
import { RequestProcessor } from '@request-processor';

export function httpServerFactory(requestProcessorOptions: RequestProcessorOptions, ssl?: SecureContextOptions) {
  const requestProcessor: RequestProcessor = new RequestProcessor(requestProcessorOptions);
  const handler = requestProcessor.process.bind(requestProcessor);
  return ssl ? https.createServer(ssl, handler) : http.createServer(handler);
}
