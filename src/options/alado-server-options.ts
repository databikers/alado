import { ServerOptions } from 'http';
import { AladoServerLogger } from '@dto';
import { OpenApiDoc } from './open-api-doc';
import { CorsOptions } from './cors-options';
import { SecureContextOptions } from 'tls';

export type AladoServerOptions = {
  port: number;
  cors: CorsOptions;
  openApiDoc: OpenApiDoc;
  headers?: Record<string, string>;
  serverOptions?: ServerOptions;
  host?: string;
  backlog?: number;
  ssl?: SecureContextOptions;
  logger?: AladoServerLogger;
};
