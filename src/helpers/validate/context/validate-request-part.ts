import { Context, ContextRequest, PropertyDefinition } from '@dto';

const nonProcessingRequestParts: string[] = [
  'files',
  'auth',
];

export async function validateRequestPart(
  key: keyof ContextRequest,
  context: Context<any>,
  request: any,
): Promise<{ statusCode: number; message: string }> {
  if (nonProcessingRequestParts.includes(key)) {
    return;
  }
  if (
    !Object.keys(context.request[key]).length &&
    !context.options?.allowUnknownFields &&
    ![
      'headers',
      'rawBody',
    ].includes(key)
  ) {
    request[key] = {};
  }
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
      } catch (e) {
        return {
          statusCode: error.statusCode,
          message: e.message,
        };
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
