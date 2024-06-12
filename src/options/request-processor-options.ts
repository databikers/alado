import { Router } from '@router';
import { OpenApiDoc } from './open-api-doc';
import { AladoServerLogger } from '@dto';

export interface RequestProcessorOptions {
  router: Router;
  openApiDoc: OpenApiDoc;
  enableCors?: boolean;
  logger?: AladoServerLogger;
}
