import { AccessControlConfig, AladoServerError, Context } from '@dto';
import { getProperty } from '../accessor';
import { checkDeclaredInput } from '../validate/context/request-input';

const isMissing = (value: unknown): boolean => value === undefined || value === null;

// request parts a client writes; anything else (auth.*) is set by the application
const clientParts: Set<string> = new Set([
  'headers',
  'query',
  'path',
  'body',
]);

/**
 * A rule reads its input before request validation runs, so a value from the request itself is
 * checked first, as the auth input is: a JSON body could otherwise hand an object such as
 * {"$ne": null} (a NoSQL operator) to transformInputProperty or accessControlHandler. A field with
 * a declared validator (`body.ownerId` with `ownerId` in the body DTO) is checked by it, once; any
 * other request value has to be a plain string, number, boolean or bigint. Missing values are left
 * to the rule (a comparison with a missing value already denies access).
 */
async function isValidRuleInput(context: Context<any>, request: any, path: string, value: unknown): Promise<boolean> {
  const segments: string[] = path.split('.');
  if (!clientParts.has(segments[0]) || isMissing(value)) {
    return true;
  }
  if (segments.length === 2) {
    const declared: boolean | undefined = await checkDeclaredInput(
      request,
      context.request,
      segments[0],
      segments[1],
      value,
    );
    if (declared !== undefined) {
      return declared;
    }
  }
  return [
    'string',
    'number',
    'boolean',
    'bigint',
  ].includes(typeof value);
}

export async function accessControlChecker(context: Context<any>, request: any): Promise<AladoServerError | void> {
  const { accessControl } = context;
  let success: boolean = true;
  for (const item of accessControl) {
    const {
      inputProperty,
      transformInputProperty,
      statusCode,
      message,
      compareWithProperty,
      expectedValue,
      accessControlHandler,
    } = item;

    const rawValue: unknown = getProperty(request, inputProperty);
    if (!(await isValidRuleInput(context, request, inputProperty, rawValue))) {
      return { statusCode, message };
    }
    let providedValue: unknown = rawValue;

    if (typeof transformInputProperty === 'function') {
      providedValue = await transformInputProperty(providedValue);
    }

    if (expectedValue !== undefined) {
      success = expectedValue === providedValue;
    }

    if (!success) {
      return { statusCode, message };
    }

    if (compareWithProperty) {
      const compareWithValue: unknown = getProperty(request, compareWithProperty);
      // A missing value never grants access: undefined === undefined would let an anonymous
      // request through, and a transform such as String(v) would turn it into "undefined".
      success =
        !isMissing(rawValue) &&
        !isMissing(providedValue) &&
        !isMissing(compareWithValue) &&
        compareWithValue === providedValue;
    }

    if (!success) {
      return { statusCode, message };
    }

    if (typeof accessControlHandler === 'function') {
      success = await accessControlHandler(providedValue);
    }

    if (!success) {
      return { statusCode, message };
    }
  }
}
