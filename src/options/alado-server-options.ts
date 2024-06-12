import { AladoServerLogger } from '@dto';
import { OpenApiDoc } from './open-api-doc';
import { CorsOptions } from './cors-options';
import { SecureContextOptions } from 'tls';

export interface AladoServerOptions {
  port: number;
  cors: CorsOptions;
  openApiDoc: OpenApiDoc;
  ssl?: SecureContextOptions;
  logger?: AladoServerLogger;
}
