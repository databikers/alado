import { HttpMethod, httpMethods } from '@const';
import { AladoServerLogger, Context, Request, Response, Route } from '@dto';
import { RouterOptions } from '@options';
import { openApiDocFactory } from '@factory';
import { clearRoutePath, validateContext } from '@helper';

const pathVariableRegex = /:[a-zA-Z0-9_]+/g;

// TODO: default route 404;
type RouterUseArgs =
  | [HttpMethod, string, Context<any>, (request: Request) => void]
  | [HttpMethod, string, (request: Request) => void];
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
    this.logger = options.logger;
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
    let route: string = `${method}${clearRoutePath(uri)}`;

    let openApiRoute: string = uri;
    const openApiMethod: string = method.toLowerCase();

    let optionsRoute: string = `${HttpMethod.OPTIONS}${clearRoutePath(uri)}`;
    const matches: RegExpMatchArray = route.match(pathVariableRegex);
    if (matches) {
      for (let i = 0; i < matches.length; i++) {
        const variable: string = matches[i].replace(':', '');
        pathData[variable] = i + 1;
        openApiRoute = openApiRoute.replace(`:${variable}`, `{${variable}}`);
        route = route.toString().replace(matches[i], '([a-zA-Z0-9_\\-\\.]+)');
        optionsRoute = optionsRoute.toString().replace(matches[i], '([a-zA-Z0-9_\\-\\.]+)');
      }
    }

    if (this.options.openApiDoc?.enable) {
      openApiDocFactory(openApiMethod, openApiRoute, context, this.openApiDocObject);
    }

    const routeRegEx: RegExp = new RegExp(`^${route.replace(/\//g, '/')}\/?$`, 'i');
    const optionsDataKey: string = this.getOptionsDataKey(method, routeRegEx);

    if (this.options.cors?.enable) {
      if (this.options.cors.allowedMethods.has(optionsDataKey)) {
        this.options.cors.allowedMethods.get(optionsDataKey).push(method);
      } else {
        this.options.cors.allowedMethods.set(optionsDataKey, [HttpMethod.OPTIONS, method]);
        const optionsRouteRegEx: RegExp = new RegExp(`^${optionsRoute.replace(/\//g, '/')}\/?$`, 'i');
        this.routes.set(optionsRouteRegEx, {
          route: optionsRouteRegEx,
          path: pathData,
          context,
          handler: (request: Request) => {
            return {
              statusCode: 204,
              headers: {
                'Access-Control-Allow-Origin': this.options.cors.allowedOrigin,
                'Access-Control-Allow-Methods': this.getOptionsData(optionsDataKey).join(', '),
                'Access-Control-Allow-Headers': this.options.cors.allowedHeaders.join(', '),
                'Access-Control-Expose-Headers': this.options.cors.exposeHeaders.join(', '),
              },
            };
          },
        });
      }
    }
    this.routes.set(routeRegEx, { route: routeRegEx, path: pathData, context, handler });
  }

  protected getOptionsDataKey(method: string, routeRegEx: RegExp) {
    return routeRegEx.toString().replace(`^${method}\\/`, '');
  }

  public getOptionsData(key: string) {
    return this.options.cors.allowedMethods.get(key);
  }

  parse(method: HttpMethod, uri: string): Route<any> {
    uri = clearRoutePath(uri);
    const p = `${method}${uri}`;
    const keys = Array.from(this.routes.keys());
    const path: any = {};
    for (let i = 0; i < keys.length; i++) {
      const route: RegExp = keys[i];
      const matches: RegExpMatchArray = p.match(route);
      if (matches) {
        const data: Route<any> = this.routes.get(route);
        for (const k in data.path) {
          path[k] = matches[data.path[k] as unknown as number];
        }
        const optionsDataKey: string = this.getOptionsDataKey(method, keys[i]);
        const allowedMethods: HttpMethod[] = this.options.cors.allowedMethods.get(optionsDataKey);
        return { ...data, path, allowedMethods };
      }
    }
  }
}
