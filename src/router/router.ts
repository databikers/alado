import { HttpMethod, httpMethods } from '@const';
import { AladoConfigurationError, AladoServerLogger, Context, Request, Response, Route } from '@dto';
import { RouterOptions } from '@options';
import { openApiDocFactory } from '@factory';
import { clearRoutePath, isOpenApiPath, normalizeHeaderNames, validateContext, safeLog } from '@helper';

const pathVariableRegex = /:([^/]+)/g;

/**
 * Path params arrive percent-encoded ("john%20doe"); handlers get the decoded value. Only values
 * containing '%' are decoded, so the common case costs nothing. Malformed encoding is a 400.
 */
function decodePathParam(value: string): string {
  if (value.indexOf('%') === -1) {
    return value;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    throw { statusCode: 400, message: 'Malformed path parameter' };
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function toRoutePattern(path: string): { pattern: string; params: string[] } {
  const params: string[] = [];
  let pattern: string = '';
  let last: number = 0;
  for (const match of path.matchAll(pathVariableRegex)) {
    pattern += escapeRegExp(path.slice(last, match.index));
    pattern += '([^/]+?)';
    params.push(match[1]);
    last = (match.index as number) + match[0].length;
  }
  pattern += escapeRegExp(path.slice(last));
  return { pattern, params };
}

// "/a/b" -> ["a", "b"]; the root path ("" after clearRoutePath) has no segments
function splitPath(cleanPath: string): string[] {
  return cleanPath === '' || cleanPath === '/' ? [] : cleanPath.slice(1).split('/');
}

/**
 * Depth-first search for the route matching the rest of `path` from `start` (just after a '/'):
 * the literal child first, then param children; `values` collects param values on the way down
 * and is unwound on backtracking. Segments are read in place, so a lookup allocates nothing but
 * the segment strings. Recursion depth is bounded by the deepest registered route.
 */
function findRoute(node: TrieNode, path: string, start: number, lowerCase: boolean, values: string[]): TrieNode | null {
  if (start > path.length) {
    return node.route !== null ? node : null;
  }
  let end: number = path.indexOf('/', start);
  if (end === -1) {
    end = path.length;
  }
  const segment: string = path.slice(start, end);
  const key: string = lowerCase ? segment.toLowerCase() : segment;
  if (node.statics !== null) {
    const child: TrieNode | undefined = node.statics.get(key);
    if (child !== undefined) {
      const found: TrieNode | null = findRoute(child, path, end + 1, lowerCase, values);
      if (found !== null) {
        return found;
      }
    }
  }
  if (node.params !== null) {
    for (let j: number = 0; j < node.params.length; j++) {
      const edge: ParamEdge = node.params[j];
      // a param needs at least one character, as ([^/]+?) did
      if (key.length > edge.prefix.length && (edge.prefix === '' || key.startsWith(edge.prefix))) {
        values.push(edge.prefix === '' ? segment : segment.slice(edge.prefix.length));
        const found: TrieNode | null = findRoute(edge.node, path, end + 1, lowerCase, values);
        if (found !== null) {
          return found;
        }
        values.pop();
      }
    }
  }
  return null;
}

/** Like findRoute(), but visits every match and collects the methods of the routes ending there. */
function collectMethods(node: TrieNode, path: string, start: number, lowerCase: boolean, found: Set<string>): void {
  if (start > path.length) {
    node.methods?.forEach((method: string) => found.add(method));
    return;
  }
  let end: number = path.indexOf('/', start);
  if (end === -1) {
    end = path.length;
  }
  const segment: string = path.slice(start, end);
  const key: string = lowerCase ? segment.toLowerCase() : segment;
  const child: TrieNode | undefined = node.statics?.get(key);
  if (child !== undefined) {
    collectMethods(child, path, end + 1, lowerCase, found);
  }
  if (node.params !== null) {
    for (let j: number = 0; j < node.params.length; j++) {
      const edge: ParamEdge = node.params[j];
      if (key.length > edge.prefix.length && (edge.prefix === '' || key.startsWith(edge.prefix))) {
        collectMethods(edge.node, path, end + 1, lowerCase, found);
      }
    }
  }
}

// TODO: default route 404;
type RouterUseArgs =
  | [
      HttpMethod,
      string,
      Context<any>,
      (request: Request) => void,
    ]
  | [
      HttpMethod,
      string,
      (request: Request) => void,
    ];
/**
 * One path segment level of the route trie. A route segment is either literal ("users") or an
 * optional literal prefix followed by a param that runs to the end of the segment (":id", "v:version").
 */
type TrieNode = {
  // literal next segments, keyed like routeKey() (lower-cased for case-insensitive routes)
  statics: Map<string, TrieNode> | null;
  // param next segments, longest prefix first, so "v:version" is tried before ":id"
  params: ParamEdge[] | null;
  // the route ending here (first registration wins) and the names of its params, in path order
  route: Route<any> | null;
  names: string[] | null;
  // all-methods trie only: the methods that have a route ending here
  methods: Set<string> | null;
};
type ParamEdge = { prefix: string; node: TrieNode };

const newTrieNode = (): TrieNode => ({ statics: null, params: null, route: null, names: null, methods: null });
// literal: lower-cased path for routes without params, undefined otherwise
type RouteMeta = { method: string; pattern: string; literal?: string };

export class Router {
  private routes: Map<RegExp, Route<any>> = new Map<RegExp, Route<any>>();
  // per-method lookup structures, extended on every use(): exact (lower-cased) path -> route for
  // routes without params (one hash lookup), and a segment trie holding every route
  private staticRoutes: Map<string, Map<string, Route<any>>> = new Map();
  private tries: Map<string, TrieNode> = new Map();
  // every route of every method, for listing the methods a path accepts (405 Allow)
  private anyMethodTrie: TrieNode = newTrieNode();
  private meta: Map<RegExp, RouteMeta> = new Map();
  public readonly options: RouterOptions;
  public readonly openApiDocObject: any;
  public readonly logger: AladoServerLogger;
  private readonly caseSensitive: boolean;
  // "<METHOD> <shape>" -> path it was registered with, to refuse routes that could never match
  private readonly registeredShapes: Map<string, string> = new Map();
  private readonly regExpFlags: string;

  constructor(options: RouterOptions, openApiDocObject: any) {
    this.options = {
      cors: options.cors,
      openApiDoc: options.openApiDoc,
    };
    this.caseSensitive = options.caseSensitiveRoutes !== false;
    this.regExpFlags = this.caseSensitive ? '' : 'i';
    this.openApiDocObject = openApiDocObject;
    this.logger = options.logger as AladoServerLogger;
  }

  use(
    method: HttpMethod,
    uri: string,
    context: Context<any>,
    handler: (request: Request) => Response<any> | Promise<Response<any>>,
  ) {
    try {
      if (!httpMethods.includes(method)) {
        throw new Error(`Method should be on of ${httpMethods.join(', ')}`);
      }

      if (!uri || typeof uri !== 'string') {
        throw new Error(`uri should be a string`);
      }

      // the docs page, its swagger.json and Swagger UI's files are answered before any route
      if (
        this.options.openApiDoc?.enable &&
        method === HttpMethod.GET &&
        isOpenApiPath(clearRoutePath(uri), this.options.openApiDoc.route as string)
      ) {
        throw new AladoConfigurationError(
          'ROUTE_RESERVED_FOR_OPEN_API',
          `Route GET ${clearRoutePath(uri) || '/'} is used by the Open API docs already`,
        );
      }

      // a second route of the same method and path shape would never be reached: the first one wins
      const shape: string = `${method} ${this.routeShape(clearRoutePath(uri))}`;
      const registered: string | undefined = this.registeredShapes.get(shape);
      if (registered !== undefined) {
        const same: boolean = registered === clearRoutePath(uri);
        throw new AladoConfigurationError(
          'ROUTE_ALREADY_REGISTERED',
          `Route ${method} ${clearRoutePath(uri) || '/'} is already registered` +
            (same ? '' : ` as ${method} ${registered || '/'} (same path with other parameter names)`),
        );
      }

      validateContext(context, this.options.openApiDoc?.enable);

      if (typeof handler !== 'function') {
        throw new Error(`handler should be a function`);
      }
    } catch (e) {
      safeLog(this.logger, 'log', `Detected an error during the defining route ${method} ${uri}`);
      throw e;
    }
    this.registeredShapes.set(`${method} ${this.routeShape(clearRoutePath(uri))}`, clearRoutePath(uri));

    const pathData: any = {};
    let openApiRoute: string = uri;
    const openApiMethod: string = method.toLowerCase();

    const cleanUri: string = clearRoutePath(uri);
    const { pattern, params } = toRoutePattern(cleanUri);
    const literal: string | undefined = params.length ? undefined : this.routeKey(cleanUri);
    const route: string = `${method}${pattern}`;
    const optionsRoute: string = `${HttpMethod.OPTIONS}${pattern}`;
    params.forEach((variable: string, i: number) => {
      pathData[variable] = i + 1;
      openApiRoute = openApiRoute.replace(`:${variable}`, `{${variable}}`);
    });

    if (this.options.openApiDoc?.enable && !context?.options?.isHidden) {
      openApiDocFactory(openApiMethod, openApiRoute, context, this.openApiDocObject);
    }

    // after the OpenAPI doc is built (it keeps the declared spelling); once here, not per request
    normalizeHeaderNames(context);
    context.request = context.request || {};
    context.request.headers = context.request.headers || {};
    context.request.query = context.request.query || {};
    context.request.body = context.request.body || {};
    context.request.path = context.request.path || {};
    context.request.files = context.request.files || {};

    const routeRegEx: RegExp = new RegExp(`^${route.replace(/\//g, '/')}\/?$`, this.regExpFlags);
    const optionsDataKey: string = this.getOptionsDataKey(method, routeRegEx);

    if (this.options.cors?.enable) {
      if (this.options.cors?.allowedMethods?.has(optionsDataKey)) {
        this.options.cors?.allowedMethods?.get(optionsDataKey).push(method);
      } else {
        this.options.cors.allowedMethods?.set(optionsDataKey, [
          HttpMethod.OPTIONS,
          method,
        ]);
        const optionsRouteRegEx: RegExp = new RegExp(`^${optionsRoute.replace(/\//g, '/')}\/?$`, this.regExpFlags);
        this.meta.set(optionsRouteRegEx, { method: HttpMethod.OPTIONS, pattern, literal });
        const optionsData: Route<any> = {
          route: optionsRouteRegEx,
          path: pathData,
          context,
          optionsDataKey: this.getOptionsDataKey(HttpMethod.OPTIONS, optionsRouteRegEx),
          handler: (request: Request) => {
            const headers: Record<string, string> = {
              'Access-Control-Allow-Methods': this.getOptionsData(optionsDataKey).join(', '),
              'Access-Control-Allow-Headers': this.options.cors?.allowedHeaders?.join(', ') || '',
              'Access-Control-Expose-Headers': this.options.cors?.exposeHeaders?.join(', ') || '',
              'Access-Control-Allow-Credentials': this.options.cors?.allowedCredentials ? 'true' : 'false',
              // ?? and not ||: maxAge 0 (no preflight caching) is a valid value
              'Access-Control-Max-Age': Math.round(this.options.cors?.maxAge ?? 86400).toString(10),
            };
            if (Array.isArray(this.options.cors.allowedOrigin)) {
              if (this.options.cors.allowedOrigin.includes(request.origin as string)) {
                headers['Access-Control-Allow-Origin'] = request.origin as string;
              }
            } else {
              headers['Access-Control-Allow-Origin'] =
                (this.options.cors.allowedOrigin as string) || (request.origin as string);
            }
            return {
              statusCode: 204,
              headers,
            };
          },
        };
        this.routes.set(optionsRouteRegEx, optionsData);
        this.index(HttpMethod.OPTIONS, cleanUri, literal, params, optionsData);
      }
    }
    const data: Route<any> = { route: routeRegEx, path: pathData, context, handler, optionsDataKey };
    this.meta.set(routeRegEx, { method, pattern, literal });
    this.routes.set(routeRegEx, data);
    this.index(method, cleanUri, literal, params, data);
  }

  /**
   * Adds one route to the lookup structures, in O(segments): nothing already registered is
   * re-sorted or recompiled. The first registration of a method + path shape wins.
   */
  protected index(method: string, cleanUri: string, literal: string | undefined, params: string[], data: Route<any>) {
    if (literal !== undefined) {
      const table = this.staticRoutes.get(method) || new Map<string, Route<any>>();
      if (!table.has(literal)) {
        table.set(literal, data);
      }
      this.staticRoutes.set(method, table);
    }
    let root: TrieNode | undefined = this.tries.get(method);
    if (root === undefined) {
      root = newTrieNode();
      this.tries.set(method, root);
    }
    const node: TrieNode = this.insertPath(root, cleanUri);
    const shape: TrieNode = this.insertPath(this.anyMethodTrie, cleanUri);
    shape.methods = shape.methods || new Set<string>();
    shape.methods.add(method);
    if (node.route === null) {
      node.route = data;
      node.names = params;
    }
  }

  protected getOptionsDataKey(method: string, routeRegEx: RegExp) {
    return routeRegEx.toString().replace(`^${method}\\/`, '');
  }

  public getOptionsData(key: string) {
    return this.options.cors?.allowedMethods?.get(key) || [];
  }

  parse(method: HttpMethod, uri: string): Route<any> | undefined {
    return this.match(method, clearRoutePath(uri));
  }

  /**
   * The path as the router sees it: parameter names do not matter ("/users/:id" and "/users/:slug"
   * are the same route), letters are folded when routes are case-insensitive. Same parameter rule
   * as insertPath().
   */
  private routeShape(cleanUri: string): string {
    return splitPath(cleanUri)
      .map((segment: string) => {
        const colon: number = segment.indexOf(':');
        return colon === -1 || colon === segment.length - 1
          ? this.routeKey(segment)
          : `${this.routeKey(segment.slice(0, colon))}:`;
      })
      .join('/');
  }

  /** Walks (and extends) the trie below `root` along the route's segments; returns the last node. */
  protected insertPath(root: TrieNode, cleanUri: string): TrieNode {
    let node: TrieNode = root;
    for (const segment of splitPath(cleanUri)) {
      // same rule as toRoutePattern(): a param starts at the first ':' that has a name after it
      const colon: number = segment.indexOf(':');
      if (colon === -1 || colon === segment.length - 1) {
        const key: string = this.routeKey(segment);
        node.statics = node.statics || new Map<string, TrieNode>();
        let child: TrieNode | undefined = node.statics.get(key);
        if (child === undefined) {
          child = newTrieNode();
          node.statics.set(key, child);
        }
        node = child;
        continue;
      }
      const prefix: string = this.routeKey(segment.slice(0, colon));
      node.params = node.params || [];
      let edge: ParamEdge | undefined = node.params.find((e: ParamEdge) => e.prefix === prefix);
      if (edge === undefined) {
        edge = { prefix, node: newTrieNode() };
        node.params.push(edge);
        // stable: equal prefix lengths keep registration order
        node.params.sort((a: ParamEdge, b: ParamEdge) => b.prefix.length - a.prefix.length);
      }
      node = edge.node;
    }
    return node;
  }

  /**
   * Same as parse(), for a path that already went through clearRoutePath().
   * Param-less routes are one hash lookup. Everything else walks the method's segment trie:
   * at each segment a literal child is tried before param children (longest prefix first),
   * backtracking on a dead end. Every trie node is visited at most once, so the cost depends
   * on the path, not on how many routes are registered.
   */
  match(method: HttpMethod, uri: string): Route<any> | undefined {
    const table = this.staticRoutes.get(method);
    if (table !== undefined) {
      const data: Route<any> | undefined = table.get(this.routeKey(uri));
      if (data !== undefined) {
        return this.toResult(data, {});
      }
    }
    const root: TrieNode | undefined = this.tries.get(method);
    if (root === undefined) {
      return;
    }
    const values: string[] = [];
    // segments start after the leading '/'; the root path ("") has none, as 1 is past its end
    const node: TrieNode | null = findRoute(root, uri, 1, !this.caseSensitive, values);
    if (node === null) {
      return;
    }
    const names: string[] = node.names as string[];
    const path: Record<string, string> = {};
    for (let i: number = 0; i < names.length; i++) {
      path[names[i]] = decodePathParam(values[i]);
    }
    return this.toResult(node.route as Route<any>, path);
  }

  /**
   * Methods that have a route for this path (already through clearRoutePath()), in httpMethods
   * order: the union over every route shape that matches, found in one walk of the all-methods
   * trie. Used for 405 responses, so it only runs when match() found nothing.
   */
  public methodsFor(uri: string): HttpMethod[] {
    const found: Set<string> = new Set<string>();
    collectMethods(this.anyMethodTrie, uri, 1, !this.caseSensitive, found);
    return found.size ? httpMethods.filter((method: HttpMethod) => found.has(method)) : [];
  }

  protected routeKey(path: string): string {
    return this.caseSensitive ? path : path.toLowerCase();
  }

  protected toResult(data: Route<any>, path: Record<string, string>): Route<any> {
    return {
      route: data.route,
      path,
      context: data.context,
      handler: data.handler,
      optionsDataKey: data.optionsDataKey,
      allowedMethods: this.options.cors?.allowedMethods?.get(data.optionsDataKey as string),
    };
  }
}
