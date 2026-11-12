import { AladoServerError } from './alado-server-error';

export type RequestAuthentication = {
  inputProperty: string;
  outputProperty: string;
  handler: (value: any) => any | Promise<any>;
  handlerContext?: any;
  /**
   * Whether a request without valid credentials is refused. Defaults to true: leaving it out, or any
   * value other than an explicit `false`, refuses the request with `error`. Only `required: false`
   * lets requests through anonymously (nothing at outputProperty).
   */
  required?: boolean;
  error: AladoServerError;
};

/**
 * One way to authenticate: a strategy alone, or a group of strategies that must all pass.
 */
export type AuthAlternative = RequestAuthentication | RequestAuthentication[];

/**
 * Context.auth: one strategy, or a list of alternatives of which any one is enough. A list is OR, a
 * list inside it is AND, as in OpenAPI `security`: `[bearer, apiKey]` is bearer or apiKey,
 * `[[apiKey, bearer]]` both, `[[apiKey, bearer], basic]` both of the first two or basic.
 */
export type ContextAuth = RequestAuthentication | AuthAlternative[];
