import { Context, ContextRequest, PropertyDefinition } from '@dto';

const nonProcessingRequestParts: string[] = [
  'files',
  'auth',
];

type RequestPartError = { statusCode: number; message: string } | undefined;

export function validateRequestPart(
  key: keyof ContextRequest,
  context: Context<any>,
  request: any,
): RequestPartError | Promise<RequestPartError> {
  if (nonProcessingRequestParts.includes(key)) {
    return;
  }
  const definitions = context?.request[key] || {};
  if (
    !Object.keys(definitions).length &&
    !context.options?.allowUnknownFields &&
    ![
      'headers',
      'rawBody',
    ].includes(key)
  ) {
    request[key] = {};
  }
  let hasDefinitions: boolean = false;
  for (const _ in context.request[key]) {
    hasDefinitions = true;
    break;
  }
  if (!hasDefinitions) {
    return;
  }
  return validateDeclaredProperties(key, context, request);
}

async function validateDeclaredProperties(
  key: keyof ContextRequest,
  context: Context<any>,
  request: any,
): Promise<RequestPartError> {
  for (const property in context.request[key]) {
    const { validation, transform, isJSON } = context.request[key][property] as PropertyDefinition;
    const { required, handler, error } = validation;

    if (required && (!request[key] || !Object.prototype.hasOwnProperty.apply(request[key], [property]))) {
      return error;
    }

    if (handler && Object.prototype.hasOwnProperty.apply(request[key], [property])) {
      try {
        let value: any = request[key][property];
        const copiedValue: any = request[key][property];
        if (isJSON && typeof value === 'string') {
          try {
            value = JSON.parse(value);
          } catch (e) {
            value = copiedValue;
          }
        }
        const isValid = await handler.apply(request, [value]);
        if (!isValid) {
          return error;
        }
        if (transform) {
          request[key][property] = await transform.apply(request, [value]);
        }
      } catch {
        // the configured error, never the exception text (it may describe internals)
        return error;
      }
    }
  }
  if (!context.options?.allowUnknownFields) {
    for (const prop in request[key]) {
      if (
        ![
          'headers',
          'rawBody',
        ].includes(key) &&
        (!context.request[key] || !Object.prototype.hasOwnProperty.apply(context.request[key], [prop]))
      ) {
        delete request[key][prop];
      }
    }
  }
}
