import { AladoServerLogger } from '@dto';
import { OpenApiDoc } from './open-api-doc';
import { CorsOptions } from './cors-options';

export type RouterOptions = {
  cors: CorsOptions;
  openApiDoc?: OpenApiDoc;
  logger?: AladoServerLogger;
};
