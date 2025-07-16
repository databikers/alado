import { AladoServerOptions, CorsOptions, OpenApiDoc, OpenApiDocInfo } from '@options';
import { AladoServerLogger } from '@dto';

function validatePort(port: number) {
  if (typeof port !== 'number') {
    throw new Error('AladoServerOptions.port should be a number');
  }
  if (port < 0 || port > 65535 || port - Math.ceil(port)) {
    throw new Error('AladoServerOptions.port should be a positive integer less than 65536');
  }
}

function validateCors(cors: CorsOptions) {
  if (!cors || typeof cors !== 'object') {
    throw new Error('AladoServerOptions.cors should be an object');
  }
  if (typeof cors.enable !== 'boolean') {
    throw new Error('AladoServerOptions.cors.enable should be a boolean');
  } else if (!cors.enable) {
    return;
  }
  //maxAge
  if (
    Object.prototype.hasOwnProperty.apply(cors, ['allowedCredentials']) &&
    typeof cors.allowedCredentials !== 'boolean'
  ) {
    throw new Error('AladoServerOptions.cors.allowedCredentials should be a boolean');
  }
  if (Object.prototype.hasOwnProperty.apply(cors, ['maxAge']) && typeof cors.maxAge !== 'number' && cors.maxAge < 0) {
    throw new Error('AladoServerOptions.cors.maxAge should be a positive number');
  }
  for (const key in cors) {
    switch (key) {
      case 'allowedOrigin':
        if (
          (typeof cors[key] !== 'string' &&
          !(
            Array.isArray(cors[key]) &&
            (cors[key] as string[]).every((origin) => typeof origin === 'string' && !!origin)
          )) ||
          !cors[key]
        ) {
          throw new Error('AladoServerOptions.cors.allowedOrigin should be a non-empty string');
        }
        break;
      case 'allowedHeaders':
      case 'exposeHeaders':
        if (!Array.isArray(cors[key]) || cors[key].some((item) => typeof item !== 'string')) {
          throw new Error(`AladoServerOptions.cors.${key} should be an array of string`);
        }
        break;
    }
  }
}

function validateOpenApiDoc(openApiDoc: OpenApiDoc) {
  if (!openApiDoc || typeof openApiDoc !== 'object') {
    throw new Error('AladoServerOptions.openApiDoc should be an object');
  }
  if (typeof openApiDoc?.enable !== 'boolean') {
    throw new Error('AladoServerOptions.openApiDoc.enable should be a boolean');
  } else if (!openApiDoc.enable) {
    return;
  }
  if (typeof openApiDoc.route !== 'string') {
    throw new Error('AladoServerOptions.openApiDoc.route should be a non-empty string');
  }
  if (typeof openApiDoc.info !== 'object') {
    throw new Error('AladoServerOptions.openApiDoc.info should be an object');
  }
  for (const key in openApiDoc.info) {
    if (typeof openApiDoc?.info[key as keyof OpenApiDocInfo] !== 'string') {
      throw new Error(`AladoServerOptions.openApiDoc.info.${key} should be a string`);
    }
  }
}

function validateLogger(logger: AladoServerLogger) {
  if (!logger) {
    return;
  } else if (typeof logger !== 'object') {
    throw new Error('AladoServerOptions.logger should be an object');
  }
  if (typeof logger.log !== 'function') {
    throw new Error('AladoServerOptions.logger.log should be a function');
  }
}

export function validateAladoOptions(options: AladoServerOptions) {
  const { port, cors, openApiDoc, logger } = options;
  validatePort(port);
  validateCors(cors);
  validateOpenApiDoc(openApiDoc);
  validateLogger(logger);
}
