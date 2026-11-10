import { timingSafeEqual } from 'crypto';
import { AccessControlConfig, AladoServerError, Context } from '@dto';
import { getProperty } from '../accessor';
import { checkDeclaredInput } from '../validate/context/request-input';

const isMissing = (value: unknown): boolean => value === undefined || value === null;

/**
 * `===`, but two strings are compared in constant time: a rule often compares a secret (an API key
 * header with expectedValue), and a comparison that stops at the first different character tells
 * how much of a guess was right. Only the length can still be told apart.
 */
function sameValue(expected: unknown, provided: unknown): boolean {
  if (typeof expected !== 'string' || typeof provided !== 'string') {
    return expected === provided;
  }
  const a: Buffer = Buffer.from(expected);
  const b: Buffer = Buffer.from(provided);
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

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
function isValidRuleInput(
  context: Context<any>,
  request: any,
  path: string,
  value: unknown,
): boolean | Promise<boolean> {
  const segments: string[] = path.split('.');
  if (!clientParts.has(segments[0]) || isMissing(value)) {
    return true;
  }
  if (segments.length === 2) {
    const declared: boolean | undefined | Promise<boolean> = checkDeclaredInput(
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
    // only awaited when a declared validator is async
    let validInput: boolean | Promise<boolean> = isValidRuleInput(context, request, inputProperty, rawValue);
    if (typeof validInput !== 'boolean') {
      validInput = await validInput;
    }
    if (!validInput) {
      return { statusCode, message };
    }
    let providedValue: unknown = rawValue;

    if (typeof transformInputProperty === 'function') {
      providedValue = await transformInputProperty(providedValue);
    }

    if (expectedValue !== undefined) {
      success = sameValue(expectedValue, providedValue);
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
        sameValue(compareWithValue, providedValue);
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
