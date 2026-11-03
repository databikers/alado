import { AccessControlConfig, AladoServerError, Context } from '@dto';
import { getProperty } from '../accessor';

const isMissing = (value: unknown): boolean => value === undefined || value === null;

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
