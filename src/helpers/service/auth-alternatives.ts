import { ContextAuth, RequestAuthentication } from '@dto';

const cache: WeakMap<object, RequestAuthentication[][]> = new WeakMap();

/**
 * Context.auth as a list of alternatives, each a list of strategies that must all pass: `a` is
 * [[a]], `[a, b]` is [[a], [b]], `[[a, b], c]` is [[a, b], [c]]. Built once per auth config.
 */
export function authAlternatives(auth: ContextAuth | undefined): RequestAuthentication[][] {
  if (!auth) {
    return [];
  }
  let alternatives: RequestAuthentication[][] | undefined = cache.get(auth);
  if (!alternatives) {
    alternatives = Array.isArray(auth)
      ? auth.map((alternative) => (Array.isArray(alternative) ? alternative : [alternative]))
      : [[auth]];
    cache.set(auth, alternatives);
  }
  return alternatives;
}

// every strategy of Context.auth, in the order declared
export function authStrategies(auth: ContextAuth | undefined): RequestAuthentication[] {
  return authAlternatives(auth).flat();
}

// the same shape with every strategy replaced by map(strategy)
export function mapAuth(
  auth: ContextAuth,
  map: (strategy: RequestAuthentication) => RequestAuthentication,
): ContextAuth {
  return Array.isArray(auth)
    ? auth.map((alternative) => (Array.isArray(alternative) ? alternative.map(map) : map(alternative)))
    : map(auth);
}
