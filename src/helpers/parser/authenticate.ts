import { AladoServerError, Context, RequestAuthentication } from '@dto';
import { getProperty, setProperty } from '../accessor';
import { checkDeclaredInput } from '../validate/context/request-input';
import { authAlternatives } from '../service/auth-alternatives';

/**
 * The auth input is checked before the handler sees it: validation of the rest of the request runs
 * only after authentication, so without this a JSON body or a repeated query key could hand the
 * handler an object or an array (e.g. {"$ne": null}, a NoSQL operator) instead of a token.
 * With a validator declared for the field (context.request.<part>.<name>) that validator decides,
 * once: request validation reuses its result. Without one, only a string is accepted.
 */
function isValidAuthInput(
  context: Context<any>,
  auth: RequestAuthentication,
  request: any,
  value: unknown,
): boolean | Promise<boolean> {
  const [
    part,
    name,
  ] = auth.inputProperty.split('.');
  const declared: boolean | undefined | Promise<boolean> = checkDeclaredInput(
    request,
    context.request,
    part,
    name,
    value,
  );
  return declared === undefined ? typeof value === 'string' : declared;
}

// refused: `presented` tells whether the client sent this strategy's credential at all
type StrategyRefusal = { passed: false; error: AladoServerError; presented: boolean };
// passed: `output` is written to outputProperty once the whole alternative has passed;
// `authenticated` when a credential was sent and the handler accepted it
type StrategyResult = { passed: true; authenticated?: boolean; output?: { value: any } } | StrategyRefusal;

/**
 * One strategy. `required` defaults to true. With `required: false` a strategy never refuses:
 * credentials that are missing, invalid or make the handler throw leave it anonymous (nothing at
 * outputProperty). A handler is expected to return null/undefined for credentials it does not accept;
 * an exception is a failure of the handler and goes to `onHandlerError` (the client only ever gets
 * `error`).
 */
async function runStrategy(
  context: Context<any>,
  auth: RequestAuthentication,
  request: any,
  onHandlerError?: (error: unknown) => void,
): Promise<StrategyResult> {
  const { handler, handlerContext, inputProperty, error } = auth;
  // fail closed: only an explicit `required: false` makes authentication optional
  const required: boolean = auth.required !== false;
  const authData: any = getProperty(request, inputProperty);
  const presented: boolean = Boolean(authData);
  if (required && !authData) {
    return { passed: false, error, presented };
  }
  if (authData !== undefined && authData !== null) {
    // only awaited when a declared validator is async
    let validInput: boolean | Promise<boolean> = isValidAuthInput(context, auth, request, authData);
    if (typeof validInput !== 'boolean') {
      validInput = await validInput;
    }
    if (!validInput) {
      return required ? { passed: false, error, presented } : { passed: true };
    }
  }
  try {
    const result = await handler.apply(handlerContext || {}, [authData]);
    if (!result && required) {
      return { passed: false, error, presented };
    }
    return { passed: true, authenticated: presented && Boolean(result), output: { value: result } };
  } catch (e) {
    onHandlerError?.(e);
    // the configured error, never the exception text (it may describe internals)
    return required ? { passed: false, error, presented } : { passed: true };
  }
}

/**
 * Authenticates a request against Context.auth: alternatives are tried in the order declared, and
 * the first whose strategies all pass and that authenticated a credential wins (the rest are not
 * run). An alternative that passes only because its strategies are optional (no credential sent, or
 * one refused) is kept as a fallback while the later alternatives are tried: with
 * `@withAuth(optionalBearer, optionalApiKey)` a request carrying only an API key is authenticated by
 * the second, not left anonymous by the first. The fallback is used when no later alternative
 * authenticates, which keeps a single optional strategy working as before. Outputs are written only
 * for the alternative used: a group that fails half-way leaves nothing behind. When none passes, the
 * error is the one of the first alternative whose credential was sent but refused, or else the one
 * of the first alternative (nothing was sent).
 */
export async function authenticate(
  context: Context<any>,
  request: any,
  onHandlerError?: (error: unknown) => void,
): Promise<AladoServerError | undefined> {
  let firstError: AladoServerError | undefined;
  let rejectedError: AladoServerError | undefined;
  // outputs of the first alternative that passed without authenticating anyone
  let anonymous:
    | Array<
        [
          string,
          any,
        ]
      >
    | undefined;
  for (const alternative of authAlternatives(context.auth)) {
    const outputs: Array<
      [
        string,
        any,
      ]
    > = [];
    let refused: StrategyRefusal | undefined;
    let authenticated: boolean = false;
    for (const auth of alternative) {
      const result: StrategyResult = await runStrategy(context, auth, request, onHandlerError);
      if (result.passed === false) {
        refused = result;
        break;
      }
      authenticated ||= Boolean(result.authenticated);
      if (result.output) {
        outputs.push([
          auth.outputProperty,
          result.output.value,
        ]);
      }
    }
    if (!refused) {
      if (!authenticated) {
        anonymous ??= outputs;
        continue;
      }
      writeOutputs(request, outputs);
      return undefined;
    }
    firstError ??= refused.error;
    if (refused.presented) {
      rejectedError ??= refused.error;
    }
  }
  if (anonymous) {
    writeOutputs(request, anonymous);
    return undefined;
  }
  return rejectedError ?? firstError;
}

function writeOutputs(
  request: any,
  outputs: Array<
    [
      string,
      any,
    ]
  >,
) {
  for (const [
    outputProperty,
    value,
  ] of outputs) {
    setProperty(request, outputProperty, value);
  }
}
