import { ContextRequest, PropertyDefinition } from '@dto';
import { parseJson } from '../../parser/json-parser';
import { NumericInputType, numericInput, toNumericInput } from '../built-in/numeric-input';

/**
 * The value a declared validator sees. Query and path values are strings: a number()/bigint()
 * validator gets them converted (`numeric` tells the caller to store the converted value). An
 * isJSON field gets the parsed JSON, from the same parser as JSON bodies, so a field such as
 * {"__proto__":{...}} never reaches a validator or a transform with an own __proto__ key.
 */
export function validatorInput(
  key: string,
  definition: PropertyDefinition,
  raw: unknown,
): { value: unknown; numeric: boolean } {
  let value: unknown = raw;
  let numeric: boolean = false;
  const numericType: NumericInputType | undefined = (definition.validation?.handler as any)?.[numericInput];
  if (numericType && (key === 'query' || key === 'path') && typeof value === 'string') {
    value = toNumericInput(numericType, value);
    numeric = typeof value !== 'string';
  }
  if (definition.isJSON && typeof value === 'string') {
    try {
      value = parseJson(value);
    } catch {
      // the validator gets the raw string
    }
  }
  return { value, numeric };
}

// "<part>.<name>" -> the raw value that already passed its declared validator, kept on the request
// itself (not in a WeakMap: an entry per short-lived request is costly for the garbage collector)
const PREVALIDATED: unique symbol = Symbol('alado.prevalidated');

type Prevalidated = Record<string, unknown>;

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return value !== null && typeof value === 'object' && typeof (value as any).then === 'function';
}

/** Whether request[key][property] still holds a value its declared validator accepted earlier. */
export function isPrevalidated(request: any, key: string, property: string, raw: unknown): boolean {
  const values: Prevalidated | undefined = request[PREVALIDATED];
  return values !== undefined && raw !== undefined && values[`${key}.${property}`] === raw;
}

function remember(request: any, key: string, property: string, raw: unknown): true {
  let values: Prevalidated | undefined = request[PREVALIDATED];
  if (values === undefined) {
    values = Object.create(null) as Prevalidated;
    Object.defineProperty(request, PREVALIDATED, { value: values });
  }
  values[`${key}.${property}`] = raw;
  return true;
}

/**
 * Runs the validator declared for request[key][property] ahead of request validation (for the auth
 * input and access-control inputs, which are read before it). `undefined` when no validator is
 * declared. An accepted value is remembered, so request validation does not run the validator
 * again for it (a slow or side-effecting validator runs once per request). Synchronous unless the
 * validator returns a promise.
 */
export function checkDeclaredInput(
  request: any,
  definitions: ContextRequest | undefined,
  key: string,
  property: string,
  raw: unknown,
): boolean | undefined | Promise<boolean> {
  const definition: PropertyDefinition | undefined = (definitions as any)?.[key]?.[property];
  const handler = definition?.validation?.handler;
  if (typeof handler !== 'function') {
    return undefined;
  }
  let result: unknown;
  try {
    result = handler.apply(request, [validatorInput(key, definition as PropertyDefinition, raw).value]);
  } catch {
    return false;
  }
  if (isThenable(result)) {
    return Promise.resolve(result).then(
      (ok: unknown) => (ok ? remember(request, key, property, raw) : false),
      () => false,
    );
  }
  return result ? remember(request, key, property, raw) : false;
}
