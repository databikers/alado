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
export class Router {
  private routes: Map<RegExp, Route<any>> = new Map<RegExp, Route<any>>();
  public readonly options: RouterOptions;
  public readonly openApiDocObject: any;
  public readonly logger: AladoServerLogger;

  constructor(options: RouterOptions, openApiDocObject: any) {
    this.options = {
      cors: options.cors,
      openApiDoc: options.openApiDoc,
    };
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

    const { pattern, params } = toRoutePattern(clearRoutePath(uri));
    const route: string = `${method}${pattern}`;
    const optionsRoute: string = `${HttpMethod.OPTIONS}${pattern}`;
    params.forEach((variable: string, i: number) => {
      pathData[variable] = i + 1;
      openApiRoute = openApiRoute.replace(`:${variable}`, `{${variable}}`);
    });

    if (this.options.openApiDoc?.enable && !context?.options?.isHidden) {
      openApiDocFactory(openApiMethod, openApiRoute, context, this.openApiDocObject);
    }

    const routeRegEx: RegExp = new RegExp(`^${route.replace(/\//g, '/')}\/?$`, 'i');
    const optionsDataKey: string = this.getOptionsDataKey(method, routeRegEx);

    if (this.options.cors?.enable) {
      if (this.options.cors?.allowedMethods?.has(optionsDataKey)) {
        this.options.cors?.allowedMethods?.get(optionsDataKey).push(method);
      } else {
        this.options.cors.allowedMethods?.set(optionsDataKey, [
          HttpMethod.OPTIONS,
          method,
        ]);
        const optionsRouteRegEx: RegExp = new RegExp(`^${optionsRoute.replace(/\//g, '/')}\/?$`, 'i');
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
  }

  protected getOptionsDataKey(method: string, routeRegEx: RegExp) {
    return routeRegEx.toString().replace(`^${method}\\/`, '');
  }

  public getOptionsData(key: string) {
    return this.options.cors?.allowedMethods?.get(key) || [];
  }

  parse(method: HttpMethod, uri: string): Route<any> | undefined {
    uri = clearRoutePath(uri);
    const p = `${method}${uri}`;
    const path: any = {};
    for (const [
      route,
      data,
    ] of this.routes) {
      const matches: RegExpMatchArray | null = p.match(route);
      if (matches) {
        for (const k in data.path) {
          path[k] = matches[data.path[k] as unknown as number];
        }
        const allowedMethods: HttpMethod[] = this.options.cors!.allowedMethods!.get(
          data.optionsDataKey ?? this.getOptionsDataKey(method, route),
        );
        return { ...data, path, allowedMethods };
      }
    }
  }
}
