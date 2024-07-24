import { Server } from 'http';

import { HttpMethod, defaultOpenApiDocObject } from '@const';
import { AladoServerOptions } from '@options';
import { AladoServerLogger, Context, Response } from '@dto';
import { Router } from '@router';
import { httpServerFactory } from '@factory';
import { clearRoute, validateAladoOptions } from '@helper';

export class AladoServer {
  private readonly router: Router;
  private readonly server: Server;
  private readonly openApiDocObject: any;
  private port: number;
  private readonly logger?: AladoServerLogger;

  constructor(options: AladoServerOptions) {
    validateAladoOptions(options);
    if (options.openApiDoc?.route) {
      options.openApiDoc.route = `${clearRoute(options.openApiDoc.route)}`;
    }
    this.logger = options.logger || (console as AladoServerLogger);
    this.openApiDocObject = { ...defaultOpenApiDocObject, info: options.openApiDoc?.info || {} };
    this.router = new Router(
      {
        cors: {
          enable: options.cors?.enable,
          allowedOrigin: options?.cors?.allowedOrigin || '*',
          allowedHeaders: options?.cors?.allowedHeaders || [],
          allowedMethods: new Map<any, any>(),
          exposeHeaders: options?.cors?.exposeHeaders || [],
        },
        openApiDoc: options.openApiDoc,
        logger: this.logger,
      },
      this.openApiDocObject,
    );
    this.port = options.port;
    this.server = httpServerFactory(
      {
        router: this.router,
        openApiDoc: options.openApiDoc,
        enableCors: options.cors?.enable,
        logger: this.logger,
      },
      options.ssl,
    );
  }

  public get(path: string, context: Context<any>, handler: (request: any) => Response<any> | Promise<Response<any>>) {
    this.router.use(HttpMethod.GET, path, context, handler);
  }

  public post(path: string, context: Context<any>, handler: (request: any) => Response<any> | Promise<Response<any>>) {
    this.router.use(HttpMethod.POST, path, context, handler);
  }

  public put(path: string, context: Context<any>, handler: (request: any) => Response<any> | Promise<Response<any>>) {
    this.router.use(HttpMethod.PUT, path, context, handler);
  }

  public patch(path: string, context: Context<any>, handler: (request: any) => Response<any> | Promise<Response<any>>) {
    this.router.use(HttpMethod.PATCH, path, context, handler);
  }

  public delete(
    path: string,
    context: Context<any>,
    handler: (request: any) => Response<any> | Promise<Response<any>>,
  ) {
    this.router.use(HttpMethod.DELETE, path, context, handler);
  }

  public head(path: string, context: Context<any>, handler: (request: any) => Promise<Response<any>>) {
    this.router.use(HttpMethod.HEAD, path, context, handler);
  }

  start(cb: (err?: Error) => void) {
    this.server.listen(this.port, cb);
  }

  stop(cb: (error?: Error) => void) {
    this.server.close(cb);
  }
}
