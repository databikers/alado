import { DEFAULT_ID, HttpMethod } from '@const';
import { injector } from '@injector';
import { AladoServer } from '@alado';

// TODO: type for options

function callHttpMethod(httpMethod: HttpMethod, path: string, options: any = {}) {
  const defaultDescription: string = `${httpMethod} ${path}`;
  const normalizedMethod: string = httpMethod.toLowerCase();
  const appId: string = options?.appId || DEFAULT_ID;
  const app: AladoServer = injector.injected.appMapping[appId];
  return function (instance: any, method: string) {
    const key: string = `${instance.constructor.name}.${method}`;
    app[normalizedMethod as 'post' | 'get' | 'put' | 'patch' | 'delete' | 'head'](
      path,
      {
        title: options.title || defaultDescription,
        auth: injector.injected.authMapping[key] || undefined,
        options: {
          allowUnknownFields: false,
          isHidden: options.isHidden || false,
          openApiDoc: {
            description: options.description || defaultDescription,
            operationId: defaultDescription,
            tags: options.tags || [],
          },
        },
        request: injector.injected.requestMapping[key],
        response: injector.injected.responseMapping[key],
      },
      instance[method].bind(instance),
    );
  };
}

export function get(path: string, options: any = {}) {
  return callHttpMethod(HttpMethod.GET, path, options);
}

export function post(path: string, options: any = {}) {
  return callHttpMethod(HttpMethod.POST, path, options);
}

export function put(path: string, options: any = {}) {
  return callHttpMethod(HttpMethod.PUT, path, options);
}

export function patch(path: string, options: any = {}) {
  return callHttpMethod(HttpMethod.PATCH, path, options);
}

export function del(path: string, options: any = {}) {
  return callHttpMethod(HttpMethod.DELETE, path, options);
}

export function head(path: string, options: any = {}) {
  return callHttpMethod(HttpMethod.HEAD, path, options);
}
