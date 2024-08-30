import { Router } from '@router';
import { OpenApiDoc } from './open-api-doc';
import { AladoServerLogger } from '@dto';

export type RequestProcessorOptions = {
  router: Router;
  openApiDoc: OpenApiDoc;
  enableCors?: boolean;
  headers?: Record<string, string>;
  logger?: AladoServerLogger;
};
