import { ServerOptions } from 'http';
import { AladoServerLogger } from '@dto';
import { OpenApiDoc } from './open-api-doc';
import { CorsOptions } from './cors-options';
import { ParsingOptions } from './parsing-options';
import { SecureContextOptions } from 'tls';

export type AladoServerOptions = {
  port: number;
  cors?: CorsOptions;
  openApiDoc?: OpenApiDoc;
  headers?: Record<string, string>;
  serverOptions?: ServerOptions;
  host?: string;
  backlog?: number;
  ssl?: SecureContextOptions;
  logger?: AladoServerLogger;
  verbose?: boolean;
  appId?: string;
  maxBodySizeBytes?: number;
  trustProxy?: boolean | number;
  caseSensitiveRoutes?: boolean;
  parsing?: ParsingOptions;
  // how long a handler may take to answer, in milliseconds (default 60 000, a slower one gets 503);
  // 0 for no limit
  handlerTimeoutMs?: number;
};
