import { Context, PropertyDefinition, RequestAuthentication } from '@dto';
import { getProperty, setProperty } from '../accessor';
import { parseJson } from './json-parser';

/**
 * The auth input is checked before the handler sees it: validation of the rest of the request runs
 * only after authentication, so without this a JSON body or a repeated query key could hand the
 * handler an object or an array (e.g. {"$ne": null}, a NoSQL operator) instead of a token.
 * With a validator declared for the field (context.request.<part>.<name>) that validator decides;
 * without one, only a string is accepted.
 */
async function isValidAuthInput(context: Context<any>, request: any, value: unknown): Promise<boolean> {
  const [
    part,
    name,
  ] = (context.auth as RequestAuthentication).inputProperty.split('.');
  const definition: PropertyDefinition | undefined = (context.request as any)?.[part]?.[name];
  const handler = definition?.validation?.handler;
  if (typeof handler !== 'function') {
    return typeof value === 'string';
  }
  let input: unknown = value;
  if (definition?.isJSON && typeof value === 'string') {
    try {
      input = parseJson(value);
    } catch {
      // the validator gets the raw string, as in request validation
    }
  }
  try {
    return Boolean(await handler.apply(request, [input]));
  } catch {
    return false;
  }
}

export async function authenticate(context: Context<any>, request: any): Promise<any> {
  const { auth } = context;
  const { required, handler, handlerContext, inputProperty, outputProperty, error } = auth as RequestAuthentication;

  const authData: any = getProperty(request, inputProperty);
  if (required && !authData) {
    return error;
  }
  if (authData !== undefined && authData !== null && !(await isValidAuthInput(context, request, authData))) {
    return error;
  }
  try {
    const result = await handler.apply(handlerContext || {}, [authData]);
    if (!result && required) {
      return error;
    }
    setProperty(request, outputProperty, result);
  } catch {
    // the configured error, never the exception text (it may describe internals)
    return error;
  }
}
