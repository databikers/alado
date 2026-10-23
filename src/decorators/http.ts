import { DEFAULT_ID, HttpMethod } from '@const';
import { injector } from '@injector';
import { AladoServer } from '@alado';
import { ContextOptions, HttpDecoratorOptions } from '@options';
import { initializeInjector } from './initialize-injector';
import { controllerInstances } from './controller-instances';

function callHttpMethod(httpMethod: HttpMethod, path: string, options: HttpDecoratorOptions = {}) {
  initializeInjector();
  const defaultDescription: string = `${httpMethod} ${path}`;
  const normalizedMethod: string = httpMethod.toLowerCase();
  const appId: string = options?.appId || DEFAULT_ID;
  const app: AladoServer = injector.injected.appMapping[appId];
  return function (instance: any, method: string) {
    const key: string = `${instance.constructor.name}.${method}`;
    const fn = (app: AladoServer): void => {
      app[normalizedMethod as 'post' | 'query' | 'get' | 'put' | 'patch' | 'delete' | 'head'](
        path,
        {
          title: options.title || defaultDescription,
          auth: injector.injected.authMapping[key] || undefined,
          accessControl: injector.injected.accessControlMapping[key] || undefined,
          options: {
            allowUnknownFields: false,
            isHidden: options.isHidden || false,
            openApiDoc: {
              description: options.description || defaultDescription,
              operationId: defaultDescription,
              tags: options.tags || [],
            },
          } as ContextOptions,
          request: injector.injected.requestMapping[key] || {},
          response: injector.injected.responseMapping[key] || {},
        },
        // `instance` is the prototype; call on the constructed controller so
        // properties set in its constructor (injected services, options) exist
        (request: any) => instance[method].call(controllerInstances.get(instance) ?? instance, request),
      );
    };
    if (app) {
      fn(app);
      const shadowApp = injector.injected.shadowAppMapping[appId];
      if (Array.isArray(shadowApp) && shadowApp.length) {
        while (shadowApp.length) {
          const fn = shadowApp.pop();
          fn(app);
        }
      }
    } else {
      injector.injected.shadowAppMapping[appId] = injector.injected.shadowAppMapping[appId] || [];
      injector.injected.shadowAppMapping[appId].push(fn);
    }
  };
}

export function get(path: string, options: HttpDecoratorOptions = {}) {
  return callHttpMethod(HttpMethod.GET, path, options);
}

export function query(path: string, options: HttpDecoratorOptions = {}) {
  return callHttpMethod(HttpMethod.QUERY, path, options);
}

export function post(path: string, options: HttpDecoratorOptions = {}) {
  return callHttpMethod(HttpMethod.POST, path, options);
}

export function put(path: string, options: HttpDecoratorOptions = {}) {
  return callHttpMethod(HttpMethod.PUT, path, options);
}

export function patch(path: string, options: HttpDecoratorOptions = {}) {
  return callHttpMethod(HttpMethod.PATCH, path, options);
}

export function del(path: string, options: HttpDecoratorOptions = {}) {
  return callHttpMethod(HttpMethod.DELETE, path, options);
}

export function head(path: string, options: HttpDecoratorOptions = {}) {
  return callHttpMethod(HttpMethod.HEAD, path, options);
}
