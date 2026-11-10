import { Context, RequestAuthentication } from '@dto';
import { getProperty, setProperty } from '../accessor';
import { checkDeclaredInput } from '../validate/context/request-input';

/**
 * The auth input is checked before the handler sees it: validation of the rest of the request runs
 * only after authentication, so without this a JSON body or a repeated query key could hand the
 * handler an object or an array (e.g. {"$ne": null}, a NoSQL operator) instead of a token.
 * With a validator declared for the field (context.request.<part>.<name>) that validator decides,
 * once: request validation reuses its result. Without one, only a string is accepted.
 */
function isValidAuthInput(context: Context<any>, request: any, value: unknown): boolean | Promise<boolean> {
  const [
    part,
    name,
  ] = (context.auth as RequestAuthentication).inputProperty.split('.');
  const declared: boolean | undefined | Promise<boolean> = checkDeclaredInput(
    request,
    context.request,
    part,
    name,
    value,
  );
  return declared === undefined ? typeof value === 'string' : declared;
}

/**
 * Runs the auth handler. `required` defaults to true. With `required: false` a request is never refused here: credentials that
 * are missing, invalid or make the handler throw leave it anonymous (nothing at outputProperty).
 * A handler is expected to return null/undefined for credentials it does not accept; an exception
 * is a failure of the handler and goes to `onHandlerError` (the client only ever gets `error`).
 */
export async function authenticate(
  context: Context<any>,
  request: any,
  onHandlerError?: (error: unknown) => void,
): Promise<any> {
  const { auth } = context;
  const { handler, handlerContext, inputProperty, outputProperty, error } = auth as RequestAuthentication;
  // fail closed: only an explicit `required: false` makes authentication optional
  const required: boolean = (auth as RequestAuthentication).required !== false;
  const refuse = required ? error : undefined;

  const authData: any = getProperty(request, inputProperty);
  if (required && !authData) {
    return error;
  }
  if (authData !== undefined && authData !== null) {
    // only awaited when a declared validator is async
    let validInput: boolean | Promise<boolean> = isValidAuthInput(context, request, authData);
    if (typeof validInput !== 'boolean') {
      validInput = await validInput;
    }
    if (!validInput) {
      return refuse;
    }
  }
  try {
    const result = await handler.apply(handlerContext || {}, [authData]);
    if (!result && required) {
      return error;
    }
    setProperty(request, outputProperty, result);
  } catch (e) {
    onHandlerError?.(e);
    // the configured error, never the exception text (it may describe internals)
    return refuse;
  }
}
