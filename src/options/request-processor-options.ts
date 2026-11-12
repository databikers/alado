import { Router } from '@router';
import { OpenApiDoc } from './open-api-doc';
import { AladoServerLogger } from '@dto';
import { ParsingOptions } from './parsing-options';

export type RequestProcessorOptions = {
  router: Router;
  openApiDoc: OpenApiDoc;
  enableCors?: boolean;
  headers?: Record<string, string>;
  logger?: AladoServerLogger;
  verbose?: boolean;
  maxBodySizeBytes?: number;
  trustProxy?: boolean | number;
  parsing?: ParsingOptions;
  handlerTimeoutMs?: number;
  bodyIdleTimeoutMs?: number;
};
