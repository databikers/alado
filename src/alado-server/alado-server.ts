import { Server } from 'http';

import {
  HttpMethod,
  defaultOpenApiDocObject,
  defaultHost,
  defaultBacklog,
  defaultCorsAllowedHeaders,
  defaultMaxBodySizeBytes,
  DEFAULT_ID,
} from '@const';
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
    if (!options.cors) {
      options.cors = { enable: false };
    }
    if (!options.openApiDoc) {
      options.openApiDoc = { enable: false };
    }
    validateAladoOptions(options);
    this.appId = options.appId || DEFAULT_ID;
    if (options.openApiDoc?.route) {
      options.openApiDoc.route = `${clearRoutePath(options.openApiDoc.route)}`;
    }
    this.logger = options.logger || (console as AladoServerLogger);
    // a deep copy: a shallow one would share `paths` and `components` with every other instance in
    // the process, so one server's swagger.json would list the routes of all of them
    this.openApiDocObject = { ...structuredClone(defaultOpenApiDocObject), info: options.openApiDoc?.info || {} };
    this.router = new Router(
      {
        cors: {
          enable: options.cors?.enable,
          allowedOrigin: options?.cors?.allowedOrigin || '*',
          // ?? and not ||: an explicit [] allows no request headers
          allowedHeaders: options?.cors?.allowedHeaders ?? [...defaultCorsAllowedHeaders],
          allowedMethods: new Map<any, any>(),
          exposeHeaders: options?.cors?.exposeHeaders || [],
          allowedCredentials: options?.cors?.allowedCredentials || false,
          maxAge: options?.cors?.maxAge,
        },
        openApiDoc: options.openApiDoc,
        logger: this.logger,
        caseSensitiveRoutes: options.caseSensitiveRoutes ?? true,
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
        // 0 explicitly disables the limit
        maxBodySizeBytes: options.maxBodySizeBytes ?? defaultMaxBodySizeBytes,
        trustProxy: options.trustProxy ?? false,
        parsing: { repeatedFiles: options.parsing?.repeatedFiles ?? 'last' },
      },
      options.serverOptions,
      options.ssl,
    );
  }

  public get listening(): boolean {
    return this.server.listening;
  }

  public get(path: string, context: Context<any>, handler: (request: any) => Response<any> | Promise<Response<any>>) {
    this.router.use(HttpMethod.GET, path, context, handler);
  }

  public query(path: string, context: Context<any>, handler: (request: any) => Response<any> | Promise<Response<any>>) {
    this.router.use(HttpMethod.QUERY, path, context, handler);
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
