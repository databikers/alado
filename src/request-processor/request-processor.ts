import { IncomingMessage, ServerResponse } from 'http';
import { join } from 'path';
import { createReadStream, readdirSync, readFileSync } from 'fs';

import { ContentType, HttpMethod, SWAGGER_INITIALIZER_FILE_NAME } from '@const';
import { RequestProcessorOptions } from '@options';
import { AladoServerError, ContextRequest, Request, Response } from '@dto';
import {
  accessControlChecker,
  authenticate,
  bodyParser,
  queryParser,
  clearRoutePath,
  isReadableStream,
  validateRequestFiles,
  validateRequestPart,
} from '@helper';

let swaggerUiFiles: Set<string> = new Set();
let swaggerUiAssetPath: string = '';
/**
 * Maps a request URL to a Swagger UI asset name, or undefined if it is not one.
 * The result is always an exact entry of the swagger-ui-dist listing, so no
 * part of the URL ever reaches the filesystem (no `..`, no subdirectories).
 */
export function resolveSwaggerUiFile(url: string, docsRoute: string): string | undefined {
  const route: string = clearRoutePath(docsRoute || '');
  const pathname: string = url.split('?')[0];
  let name: string;
  if (pathname === route) {
    name = 'index.html';
  } else if (route && pathname.startsWith(`${route}/`)) {
    name = pathname.slice(route.length + 1);
  } else {
    // index.html references its assets relatively, so they are requested from the root
    name = pathname.replace(/^\//, '');
  }
  return swaggerUiFiles.has(name) ? name : undefined;
}

/**
 * Errors that carry an HTTP status (thrown on purpose, e.g. `{ statusCode: 404,
 * message }`, or produced by the body parser) keep their status and message.
 * Anything else is an internal failure: the client gets a generic 500 and the
 * details only go to the logger.
 */
export function toClientError(e: any): AladoServerError {
  const statusCode: unknown = e?.statusCode;
  if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 600 && typeof e?.message === 'string') {
    return { statusCode, message: e.message };
  }
  return { statusCode: 500, message: 'Internal Server Error' };
}

// methods whose request body is read and parsed
const bodyMethods: Set<string> = new Set<string>([
  HttpMethod.PUT,
  HttpMethod.PATCH,
  HttpMethod.POST,
  HttpMethod.QUERY,
]);

export class RequestProcessor {
  private readonly options: RequestProcessorOptions;

  constructor(requestProcessorOptions: RequestProcessorOptions) {
    this.options = requestProcessorOptions;
    if (requestProcessorOptions.openApiDoc?.enable) {
      swaggerUiAssetPath = require('swagger-ui-dist').absolutePath();
      // Only regular files directly inside swagger-ui-dist are ever served.
      swaggerUiFiles = new Set(
        readdirSync(swaggerUiAssetPath, { withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => entry.name),
      );
    }
  }

  protected respond(res: ServerResponse, response: Response<any>, backgroundHeaders: Record<string, string> = {}) {
    let responseBody: any;
    const { statusCode, body } = response;
    const responseHeaders: Record<string, string> = response.headers || {};
    const headers: Record<string, string> = Object.assign({}, this.options.headers, backgroundHeaders, responseHeaders);
    const isStreamBody = isReadableStream(body);
    let contentType: string | undefined = responseHeaders['Content-Type'] ?? responseHeaders['content-type'];
    if (contentType === undefined) {
      const contentTypeKey: string | undefined = Object.keys(responseHeaders).find(
        (h) => h.toLowerCase() === 'content-type',
      );
      contentType = contentTypeKey ? responseHeaders[contentTypeKey] : undefined;
    }
    const isRawBody: boolean =
      body === undefined ||
      body === null ||
      typeof body === 'string' ||
      Buffer.isBuffer(body) ||
      body instanceof Uint8Array;
    if (contentType?.startsWith(ContentType.JSON)) {
      responseBody = isStreamBody ? body : JSON.stringify(body);
    } else if (!isStreamBody && !isRawBody) {
      // res.end() only accepts strings and buffers: serialise anything else as JSON
      if (!contentType) {
        headers['Content-Type'] = ContentType.JSON;
      }
      responseBody = JSON.stringify(body);
    } else {
      responseBody = body;
    }
    res.writeHead(statusCode, headers);
    if (isStreamBody) {
      responseBody.pipe(res);
    } else {
      res.end(responseBody);
    }
  }

  protected respondError(res: ServerResponse, error: AladoServerError, headers: Record<string, string> = {}) {
    if (res.headersSent) {
      // too late for an error response: the status line is already on the wire
      res.destroy();
      return;
    }
    const { statusCode, message } = error;
    return this.respond(res, {
      statusCode,
      headers: { ...this.options.headers, ...headers, 'Content-Type': 'application/json' },
      body: { message },
    });
  }

  public async process(req: IncomingMessage, res: ServerResponse) {
    try {
      const { router, openApiDoc, enableCors } = this.options;
      const { headers, method } = req;
      const url = clearRoutePath(req.url as string);
      const ip: string = (req.headers['x-forwarded-for'] as string) || (req.socket?.remoteAddress as string);
      const origin: string = (req.headers.origin as string) || '*';
      // Process Open API routes
      if (openApiDoc?.enable) {
        if (method === HttpMethod.GET) {
          const swaggerFile: string | undefined = req.url?.startsWith(`/swagger.json`)
            ? undefined
            : resolveSwaggerUiFile(url, openApiDoc.route as string);
          if (swaggerFile) {
            // swaggerFile is a bare name from the swagger-ui-dist listing, never a path from the URL
            const filePath = join(swaggerUiAssetPath, swaggerFile);
            if (swaggerFile === SWAGGER_INITIALIZER_FILE_NAME) {
              const initFileContent = readFileSync(filePath)
                .toString()
                .replace('https://petstore.swagger.io/v2/swagger.json', '/swagger.json');
              res.writeHead(200, {
                'Content-Type': 'application/javascript; charset=utf-8',
                'Content-Length': Buffer.byteLength(initFileContent),
              });
              res.end(initFileContent);
              return;
            }
            const stream = createReadStream(filePath);
            stream.on('error', () => {
              if (!res.headersSent) {
                this.respond(res, { statusCode: 404, headers: { 'Content-Type': 'text/plain' }, body: 'Not Found' });
              } else {
                res.destroy();
              }
            });
            stream.pipe(res);
            return;
          } else if (req.url?.startsWith(`/swagger.json`)) {
            return this.respond(res, {
              statusCode: 200,
              headers: { 'Content-Type': 'application/json' },
              body: this.options.router.openApiDocObject,
            });
          }
        }
      }
      // Process API routes
      const [
        uri,
        queryString,
      ] = url.split('?');
      const route = router.parse(method as HttpMethod, clearRoutePath(uri));
      let backgroundHeaders: Record<string, string> = {};
      if (this.options.enableCors) {
        backgroundHeaders = {
          'Access-Control-Allow-Methods': route?.allowedMethods?.join(', ') || '',
          'Access-Control-Allow-Headers': this.options.router.options.cors?.allowedHeaders?.join(', ') || '',
          'Access-Control-Expose-Headers': this.options.router.options.cors?.exposeHeaders?.join(', ') || '',
          'Access-Control-Allow-Credentials': this.options.router.options.cors?.allowedCredentials ? 'true' : 'false',
        };
        if (Array.isArray(this.options.router.options.cors.allowedOrigin)) {
          if (this.options.router.options.cors.allowedOrigin.includes(origin)) {
            backgroundHeaders['Access-Control-Allow-Origin'] = origin;
          }
        } else {
          backgroundHeaders['Access-Control-Allow-Origin'] =
            (this.options.router.options.cors.allowedOrigin as string) || origin;
        }
      }
      if (!route) {
        // Not Found
        return this.respondError(res, { statusCode: 404, message: 'Not Found' }, backgroundHeaders);
      } else {
        // CORS
        if (enableCors && method === HttpMethod.OPTIONS) {
          const response: Response<any> = await route.handler({ request: req });
          return this.respond(res, response, backgroundHeaders);
        }

        const { context, handler, path } = route;

        // Process request, prepare data
        let body: any = {};
        let rawBody: string = '';
        let query: any = {};
        let files: any = {};

        if (bodyMethods.has(method as string)) {
          const r = await bodyParser(req, res, this.options.maxBodySizeBytes as number);
          body = r.body;
          rawBody = r.rawBody;
          files = r.files;
        }

        if (context.request.query) {
          query = queryParser(queryString);
        }

        context.request.headers = context.request.headers || {};
        context.request.query = context.request.query || {};
        context.request.body = context.request.body || {};
        context.request.path = context.request.path || {};
        context.request.files = context.request.files || {};

        const request: Request = {
          request: req,
          ip,
          origin,
          method: method as HttpMethod,
          url,
          auth: {},
          headers,
          path,
          query,
        };
        if (body) {
          request.body = body;
        }
        if (rawBody) {
          request.rawBody = rawBody;
        }
        if (files) {
          request.files = files;
        }
        // Authenticate
        if (context.auth) {
          const authError: AladoServerError = await authenticate(context, request);
          if (authError) {
            return this.respondError(res, authError, backgroundHeaders);
          }
        }
        // Access control
        if (Array.isArray(context.accessControl) && context.accessControl.length) {
          const accessError = await accessControlChecker(context, request);
          if (accessError) {
            return this.respondError(res, accessError, backgroundHeaders);
          }
        }
        // Validate request
        for (const key in context.request) {
          const result = validateRequestPart(key as keyof ContextRequest, context, request);
          // only await when validators actually ran; a plain value needs no microtask
          const error: AladoServerError | undefined = result instanceof Promise ? await result : result;
          if (error) {
            return this.respondError(res, error, backgroundHeaders);
          }
        }
        // Validate request (files)
        if (context.request.files) {
          const error: AladoServerError | undefined = await validateRequestFiles(context, request);
          if (error) {
            return this.respondError(res, error, backgroundHeaders);
          }
        }
        try {
          const response: Response<any> = await handler(request);
          return this.respond(res, response, backgroundHeaders);
        } catch (e: any) {
          this.logError(e);
          return this.respondError(res, toClientError(e), backgroundHeaders);
        }
      }
    } catch (e: any) {
      this.logError(e as Error);
      return this.respondError(res, toClientError(e), {});
    }
  }

  protected logError(e: Error) {
    if (this.options.verbose) {
      this.options.logger?.error(e);
    }
  }
}
