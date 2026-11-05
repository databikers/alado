import { Context, ContextRequest, PropertyDefinition } from '@dto';
import { parseJson } from '../../parser/json-parser';

const nonProcessingRequestParts: Set<string> = new Set([
  'files',
  'auth',
]);
// parts that keep undeclared fields even when allowUnknownFields is off
const openRequestParts: Set<string> = new Set([
  'headers',
  'rawBody',
]);

type RequestPartError = { statusCode: number; message: string } | undefined;

const hasOwn = (target: any, property: string): boolean =>
  target !== null && target !== undefined && Object.prototype.hasOwnProperty.call(target, property);

function isThenable(value: any): value is PromiseLike<any> {
  return value !== null && typeof value === 'object' && typeof value.then === 'function';
}

export function validateRequestPart(
  key: keyof ContextRequest,
  context: Context<any>,
  request: any,
): RequestPartError | Promise<RequestPartError> {
  if (nonProcessingRequestParts.has(key)) {
    return;
  }
  const definitions = context?.request[key];
  let hasDefinitions: boolean = false;
  for (const _ in definitions) {
    hasDefinitions = true;
    break;
  }
  if (!hasDefinitions) {
    if (!context.options?.allowUnknownFields && !openRequestParts.has(key)) {
      request[key] = {};
    }
    return;
  }
  // declared fields need an object to live in: a JSON array, string or number body would
  // otherwise reach the handler as-is (or fail with a 500 while unknown fields are removed)
  const part: unknown = request[key];
  if (part === undefined || part === null || part === '') {
    request[key] = {};
  } else if (typeof part !== 'object' || Array.isArray(part)) {
    return { statusCode: 400, message: `Invalid request ${key}: an object is expected` };
  }
  return validateDeclaredProperties(key, context, request);
}

/**
 * Validates one declared property. Runs synchronously and only returns a Promise
 * when the validation handler or the transform does, so plain validators cost no microtasks.
 */
function validateProperty(
  key: keyof ContextRequest,
  property: string,
  definition: PropertyDefinition,
  request: any,
): RequestPartError | Promise<RequestPartError> {
  const { validation, transform, isJSON } = definition;
  const { required, handler, error } = validation;
  const part: any = request[key];
  const present: boolean = hasOwn(part, property);

  if (required && !present) {
    return error;
  }
  if (!handler || !present) {
    return;
  }
  let value: any = part[property];
  if (isJSON && typeof value === 'string') {
    try {
      // same parser as JSON bodies: a field such as {"__proto__":{...}} must not reach the
      // validator or a transform with an own __proto__ key
      value = parseJson(value);
    } catch {
      // keep the raw string
    }
  }
  // the configured error, never the exception text (it may describe internals)
  const fail = (): RequestPartError => error;
  const applyTransform = (): RequestPartError | Promise<RequestPartError> => {
    if (!transform) {
      return;
    }
    const transformed: any = transform.apply(request, [value]);
    if (isThenable(transformed)) {
      return Promise.resolve(transformed).then((v: any): RequestPartError => {
        request[key][property] = v;
        return undefined;
      }, fail);
    }
    request[key][property] = transformed;
  };
  try {
    const isValid: any = handler.apply(request, [value]);
    if (isThenable(isValid)) {
      // a rejection or a throwing transform both end up as the configured error
      return Promise.resolve(isValid)
        .then((ok: any) => (ok ? applyTransform() : error))
        .then(undefined, fail);
    }
    if (!isValid) {
      return error;
    }
    return applyTransform();
  } catch {
    return error;
  }
}

function stripUnknownFields(key: keyof ContextRequest, context: Context<any>, request: any) {
  if (context.options?.allowUnknownFields || openRequestParts.has(key)) {
    return;
  }
  const definitions: any = context.request[key];
  const part: any = request[key];
  if (part !== null && typeof part === 'object' && !Array.isArray(part) && definitions) {
    // copy instead of `delete`: deleting keys turns the object into a slow dictionary-mode
    // object, which the handler and JSON.stringify then pay for
    let unknown: boolean = false;
    for (const prop in part) {
      if (!Object.prototype.hasOwnProperty.call(definitions, prop)) {
        unknown = true;
        break;
      }
    }
    if (unknown) {
      const known: any = {};
      for (const prop in part) {
        if (Object.prototype.hasOwnProperty.call(definitions, prop)) {
          known[prop] = part[prop];
        }
      }
      request[key] = known;
    }
    return;
  }
  for (const prop in request[key]) {
    if (!definitions || !Object.prototype.hasOwnProperty.call(definitions, prop)) {
      delete request[key][prop];
    }
  }
}

async function finishAsync(
  key: keyof ContextRequest,
  context: Context<any>,
  request: any,
  properties: string[],
  index: number,
  pending: Promise<RequestPartError>,
): Promise<RequestPartError> {
  let error: RequestPartError = await pending;
  if (error) {
    return error;
  }
  for (let i: number = index + 1; i < properties.length; i++) {
    const property: string = properties[i];
    error = await validateProperty(key, property, context.request[key][property] as PropertyDefinition, request);
    if (error) {
      return error;
    }
  }
  stripUnknownFields(key, context, request);
}

function validateDeclaredProperties(
  key: keyof ContextRequest,
  context: Context<any>,
  request: any,
): RequestPartError | Promise<RequestPartError> {
  const definitions: any = context.request[key];
  const properties: string[] = Object.keys(definitions);
  for (let i: number = 0; i < properties.length; i++) {
    const property: string = properties[i];
    const result = validateProperty(key, property, definitions[property] as PropertyDefinition, request);
    if (isThenable(result)) {
      return finishAsync(key, context, request, properties, i, result as Promise<RequestPartError>);
    }
    if (result) {
      return result;
    }
  }
  stripUnknownFields(key, context, request);
}
