import { inputPropertyRegexp, outputPropertyRegexp } from '@const';
import {
  AladoServerError,
  Context,
  FilePropertyDefinition,
  PropertyDefinition,
  PropertyDocumentation,
  RequestAuthentication,
  Response,
} from '@dto';

function validateError(path: string, error: AladoServerError, errorName?: string) {
  if (!error) {
    throw new Error(`${path}.${errorName || 'error'} is required property"`);
  }
  if (typeof error.statusCode !== 'number' || error.statusCode <= 100 || error.statusCode >= 600) {
    throw new Error(`${path}.${errorName || 'error'}.statusCode should be a valid http response status code"`);
  }
  if (!error.message || typeof error.message !== 'string') {
    throw new Error(`${path}.${errorName || 'error'}.message should be a non-empty string"`);
  }
}

function validateContextAuth(auth: RequestAuthentication) {
  const { inputProperty, outputProperty, handler, required, error } = auth;

  if (!inputProperty) {
    throw new Error(`RequestAuthentication.inputProperty is required property`);
  }

  if (!inputPropertyRegexp.test(inputProperty)) {
    throw new Error(
      `RequestAuthentication.inputProperty should point to the nested property of headers|path|query|body`,
    );
  }

  if (!outputProperty) {
    throw new Error(`RequestAuthentication.outputProperty is required property `);
  }

  if (!outputPropertyRegexp.test(outputProperty)) {
    throw new Error(`RequestAuthentication.outputProperty should point to the auth or one of its nested properties`);
  }

  if (!handler) {
    throw new Error(`RequestAuthentication.handler is required property"`);
  }

  if (typeof handler !== 'function') {
    throw new Error(`RequestAuthentication.handler should be a function"`);
  }

  if (required !== undefined && typeof required !== 'boolean') {
    throw new Error(`RequestAuthentication.required should be a boolean`);
  }

  validateError('RequestAuthentication', error);
}

export function validateContextOptions(context: Context<any>, useApiDoc?: boolean) {
  if (context.options) {
    if (typeof context.options !== 'object') {
      throw new Error(`Context.options should be an object`);
    }
    if (typeof context.options.allowUnknownFields !== 'boolean') {
      throw new Error(`Context.options.allowUnknownFields should be a boolean`);
    }
    if (useApiDoc) {
      if (typeof context.options.openApiDoc !== 'object' && context.options?.openApiDoc) {
        throw new Error(`Context.options.openApiDoc should be an object`);
      } else if (typeof context.options?.openApiDoc === 'object' && context.options?.openApiDoc) {
        if (typeof context.options?.openApiDoc?.operationId !== 'string') {
          throw new Error(`Context.options.openApiDoc.operationId should be unique string`);
        }
        if (typeof context.options?.openApiDoc?.description !== 'string') {
          throw new Error(`Context.options.openApiDoc.description should be a string`);
        }
        if (context.options?.openApiDoc?.tags && !Array.isArray(context.options?.openApiDoc?.tags)) {
          throw new Error(`Context.options.openApiDoc.tags should be an array of strings`);
        }
      }
    }
  }
}

export function validateContext(context: Context<any>, useApiDoc?: boolean) {
  if (!context || typeof context !== 'object') {
    throw new Error(`Context should be an object`);
  }
  if (!context.title) {
    throw new Error(`Context.title is required property`);
  }
  if (typeof context.title !== 'string') {
    throw new Error(`Context.title should be a string`);
  }
  validateContextOptions(context, useApiDoc);
  if (context.auth) {
    validateContextAuth(context.auth);
  }
  if (context.request) {
    const { headers, path, query, body, files } = context.request;
    for (const obj of [headers, path, query, body]) {
      if (obj) {
        for (const prop in obj) {
          validatePropertyDefinition(obj[prop]);
        }
      }
    }
    if (files) {
      for (const prop in files) {
        validateFilePropertyDefinition(files[prop]);
      }
    }
  }

  if (!context.response) {
    throw new Error(`Context.response should be an object`);
  }

  validateContextResponse(context.response);
}

function validatePropertyDefinitionDoc(doc: PropertyDocumentation) {
  if (!doc.schema) {
    throw new Error(`propertyDefinition.openApiDoc.schema is required"`);
  }
  if (typeof doc.schema !== 'object') {
    throw new Error(`propertyDefinition.openApiDoc.schema should be an object"`);
  }
  // todo: move to const
  for (const key in doc.schema) {
    if (!['type', '$ref', 'enum', 'items'].includes(key)) {
      throw new Error(
        `propertyDefinition.openApiDoc.schema[property] - property should be one of ($ref, type, enum, items)"`,
      );
    }
  }
}

function validatePropertyDefinition(propertyDefinition: PropertyDefinition) {
  const { handler, error, required } = propertyDefinition.validation;
  if (!handler) {
    throw new Error(`PropertyDefinition.validation.handler is required property"`);
  }
  if (typeof handler !== 'function') {
    throw new Error(`PropertyDefinition.validation.handler should be a function"`);
  }
  if (required !== undefined && typeof required !== 'boolean') {
    throw new Error(`PropertyDefinition.validation.required should be a boolean`);
  }
  validateError('PropertyDefinition.validate', error);

  if (propertyDefinition.transform && typeof propertyDefinition.transform !== 'function') {
    throw new Error(`PropertyDefinition.transform should be a function"`);
  }
  if (propertyDefinition.openApiDoc) {
    validatePropertyDefinitionDoc(propertyDefinition.openApiDoc);
  }
}

function validateFilePropertyDefinition(filePropertyDefinition: FilePropertyDefinition) {
  const { required, mimetypes, maxSize, mimetypeError, maxSizeError, requiredError } = filePropertyDefinition;

  if (required !== undefined && typeof required !== 'boolean') {
    throw new Error(`FilePropertyDefinition.required should be a boolean`);
  }

  if (!Array.isArray(mimetypes) || mimetypes.some((item) => !item || typeof item !== 'string')) {
    throw new Error(`FilePropertyDefinition.mimetypes should be an array of string`);
  }

  if (typeof maxSize !== 'number' || maxSize <= 0) {
    throw new Error(`FilePropertyDefinition.maxSize should be a positive number`);
  }

  validateError('FilePropertyDefinition', mimetypeError, 'mimetypeError');
  validateError('FilePropertyDefinition', maxSizeError, 'maxSizeError');
  validateError('FilePropertyDefinition', requiredError, 'requiredError');
}

function validateContextResponse(response: Response<any>) {
  if (typeof response.statusCode !== 'number' || response.statusCode <= 100 || response.statusCode >= 600) {
    throw new Error(`Response.statusCode should be a valid http response status code"`);
  }
  if (response.title && typeof response.title !== 'string') {
    throw new Error(`Response.title should be a string`);
  }
  if (response.headers && typeof response.headers !== 'object') {
    throw new Error(`Response.headers should be an object`);
  }
  if (response.statusCode !== 204 && !response.body) {
    throw new Error(`Response.body should be defined or Response.statusCode should be changed to 204 (No Content)`);
  }
}
