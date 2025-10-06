import { Server } from 'http';

import { HttpMethod, defaultOpenApiDocObject, defaultHost, defaultBacklog, DEFAULT_ID } from '@const';
import { AladoServerOptions } from '@options';
import { AladoServerLogger, Context, Response } from '@dto';
import { Router } from '@router';
import { httpServerFactory } from '@factory';
import { clearRoutePath, validateAladoOptions } from '@helper';

export class AladoServer {
  private readonly appId: string;
  private readonly router: Router;
  private readonly server: Server;
  private readonly openApiDocObject: any;
  private port: number;
  private host: string;
  private backlog: number;
  private readonly logger?: AladoServerLogger;

  constructor(options: AladoServerOptions) {
    validateAladoOptions(options);
    this.appId = options.appId || DEFAULT_ID;
    if (options.openApiDoc?.route) {
      options.openApiDoc.route = `${clearRoutePath(options.openApiDoc.route)}`;
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
          allowedCredentials: options?.cors?.allowedCredentials || false,
        },
        openApiDoc: options.openApiDoc,
        logger: this.logger,
      },
      this.openApiDocObject,
    );
    this.port = options.port;
    this.host = options.host || defaultHost;
    this.backlog = options.backlog || defaultBacklog;
    this.server = httpServerFactory(
      {
        router: this.router,
        headers: options.headers,
        openApiDoc: options.openApiDoc,
        enableCors: options.cors?.enable,
        logger: this.logger,
        verbose: options.verbose,
      },
      {
        ...options.ssl,
        ...options.serverOptions,
      },
    );
  }

  public get listening(): boolean {
    return this.server.listening;
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

  public start(cb?: (err?: Error) => void): Server {
    return this.listening ? this.server : this.server.listen(this.port, this.host, this.backlog, cb);
  }

  public stop(cb: (error?: Error) => void): Server {
    return this.listening ? this.server.close(cb) : this.server;
  }
}
