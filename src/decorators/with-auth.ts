import { AuthAlternative, RequestAuthentication } from '@dto';
import { injector } from '@injector';
import { initializeInjector } from './initialize-injector';
import { memberKey } from './class-key';
import { assertNotRegistered } from './registered-members';

/**
 * Authentication for a route. Every argument is an alternative and any one of them is enough:
 * `@withAuth(bearer, apiKey)` lets in a valid bearer token or a valid API key. An array argument is
 * a group whose strategies must all pass: `@withAuth([apiKey, bearer])` needs both, and
 * `@withAuth([apiKey, bearer], basic)` needs both of them or basic. Alternatives are tried in order
 * and the first that passes wins; see allOf() for a group that is harder to misread.
 */
export function withAuth(...alternatives: AuthAlternative[]) {
  initializeInjector();
  return function (...args: any[]) {
    const [
      controller,
      method,
    ] = args;
    const key = memberKey(controller, method);
    assertNotRegistered(key, 'withAuth');
    // one strategy is kept as it is, so a route with a single one is configured exactly as before
    injector.injected.authMapping[key] =
      alternatives.length === 1 && !Array.isArray(alternatives[0]) ? alternatives[0] : alternatives;
  };
}

/**
 * A group of strategies that must all pass, the same as an array: `@withAuth(allOf(apiKey, bearer))`
 * is `@withAuth([apiKey, bearer])`. Spelled out, it cannot be confused with `@withAuth(apiKey, bearer)`
 * (either one), which is what `@withAuth(...[apiKey, bearer])` silently becomes.
 */
export function allOf(...strategies: RequestAuthentication[]): RequestAuthentication[] {
  return strategies;
}
