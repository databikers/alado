import { HttpMethod, httpMethods } from '@const';
import { AladoServerLogger, Context, Request, Response, Route } from '@dto';
import { RouterOptions } from '@options';
import { openApiDocFactory } from '@factory';
import { clearRoutePath, validateContext } from '@helper';

const pathVariableRegex = /:([^/]+)/g;

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
type DynamicRoute = {
  matcher: RegExp;
  data: Route<any>;
  params: [
    string,
    number,
  ][];
};
// literal: lower-cased path for routes without params, undefined otherwise
type RouteMeta = { method: string; pattern: string; literal?: string };

export class Router {
  private routes: Map<RegExp, Route<any>> = new Map<RegExp, Route<any>>();
  // per-method lookup tables, rebuilt on every use(): exact (lower-cased) path -> route for
  // routes without params, and an ordered list of pre-compiled matchers for the rest
  private staticRoutes: Map<string, Map<string, Route<any>>> = new Map();
  private dynamicRoutes: Map<string, DynamicRoute[]> = new Map();
  private meta: Map<RegExp, RouteMeta> = new Map();
  public readonly options: RouterOptions;
  public readonly openApiDocObject: any;
  public readonly logger: AladoServerLogger;
  private readonly caseSensitive: boolean;
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

      if (
        this.options.openApiDoc?.enable &&
        this.options.openApiDoc?.route === clearRoutePath(uri) &&
        method === HttpMethod.GET
      ) {
        throw new Error(`Route ${clearRoutePath(uri)} is used as Open API route already`);
      }

      validateContext(context, this.options.openApiDoc?.enable);

      if (typeof handler !== 'function') {
        throw new Error(`handler should be a function`);
      }
    } catch (e) {
      this.logger.log(`Detected an error during the defining route ${method} ${uri}`);
      throw e;
    }

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

    // after the OpenAPI doc is built; done once here rather than on every request
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
        this.routes.set(optionsRouteRegEx, {
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
              'Access-Control-Max-Age': Math.round(this.options.cors?.maxAge || 86400).toString(10) || '86400',
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
        });
      }
    }
    this.meta.set(routeRegEx, { method, pattern, literal });
    this.routes.set(routeRegEx, { route: routeRegEx, path: pathData, context, handler, optionsDataKey });
    this.sortRoutes();
  }

  /**
   * parse() returns the first match, so more specific routes must come first:
   * fewer path params wins (/items/featured before /items/:id), ties keep
   * registration order (Array.prototype.sort is stable).
   */
  protected sortRoutes() {
    const paramCount = (route: Route<any>): number => Object.keys(route.path || {}).length;
    this.routes = new Map(
      [...this.routes.entries()].sort(
        (
          [
            ,
            a,
          ],
          [
            ,
            b,
          ],
        ) => paramCount(a) - paramCount(b),
      ),
    );
    this.buildIndex();
  }

  protected buildIndex() {
    this.staticRoutes = new Map();
    this.dynamicRoutes = new Map();
    for (const [
      route,
      data,
    ] of this.routes) {
      const meta: RouteMeta = this.meta.get(route) as RouteMeta;
      if (meta.literal !== undefined) {
        const table = this.staticRoutes.get(meta.method) || new Map<string, Route<any>>();
        // first registration wins, as with the ordered scan
        if (!table.has(meta.literal)) {
          table.set(meta.literal, data);
        }
        this.staticRoutes.set(meta.method, table);
        continue;
      }
      const list: DynamicRoute[] = this.dynamicRoutes.get(meta.method) || [];
      list.push({
        matcher: new RegExp(`^${meta.pattern}\\/?$`, this.regExpFlags),
        data,
        params: Object.entries(data.path || {}) as unknown as [
          string,
          number,
        ][],
      });
      this.dynamicRoutes.set(meta.method, list);
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
   * Same as parse(), for a path that already went through clearRoutePath().
   * Param-less routes are a hash lookup; only routes with params are tried as RegExps,
   * and only those registered for the request method.
   */
  match(method: HttpMethod, uri: string): Route<any> | undefined {
    const table = this.staticRoutes.get(method);
    if (table !== undefined) {
      const data: Route<any> | undefined = table.get(this.routeKey(uri));
      if (data !== undefined) {
        return this.toResult(data, {});
      }
    }
    const list: DynamicRoute[] | undefined = this.dynamicRoutes.get(method);
    if (list !== undefined) {
      for (let i: number = 0; i < list.length; i++) {
        const matches: RegExpExecArray | null = list[i].matcher.exec(uri);
        if (matches !== null) {
          const path: Record<string, string> = {};
          const params = list[i].params;
          for (let j: number = 0; j < params.length; j++) {
            path[params[j][0]] = matches[params[j][1]];
          }
          return this.toResult(list[i].data, path);
        }
      }
    }
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
