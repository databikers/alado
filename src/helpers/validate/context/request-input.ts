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

// request -> "<part>.<name>" -> the raw value that already passed its declared validator
const prevalidated: WeakMap<object, Map<string, unknown>> = new WeakMap();

/** Whether request[key][property] still holds a value its declared validator accepted earlier. */
export function isPrevalidated(request: object, key: string, property: string, raw: unknown): boolean {
  const values: Map<string, unknown> | undefined = prevalidated.get(request);
  return values !== undefined && values.has(`${key}.${property}`) && values.get(`${key}.${property}`) === raw;
}

/**
 * Runs the validator declared for request[key][property] ahead of request validation (for the auth
 * input and access-control inputs, which are read before it). `undefined` when no validator is
 * declared. An accepted value is remembered, so request validation does not run the validator
 * again for it (a slow or side-effecting validator runs once per request).
 */
export async function checkDeclaredInput(
  request: any,
  definitions: ContextRequest | undefined,
  key: string,
  property: string,
  raw: unknown,
): Promise<boolean | undefined> {
  const definition: PropertyDefinition | undefined = (definitions as any)?.[key]?.[property];
  const handler = definition?.validation?.handler;
  if (typeof handler !== 'function') {
    return undefined;
  }
  let valid: boolean;
  try {
    valid = Boolean(await handler.apply(request, [validatorInput(key, definition as PropertyDefinition, raw).value]));
  } catch {
    valid = false;
  }
  if (valid) {
    let values: Map<string, unknown> | undefined = prevalidated.get(request);
    if (!values) {
      values = new Map();
      prevalidated.set(request, values);
    }
    values.set(`${key}.${property}`, raw);
  }
  return valid;
}
