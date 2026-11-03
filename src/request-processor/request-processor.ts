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

function hasKeys(value: any): boolean {
  for (const _ in value) {
    return true;
  }
  return false;
}

export function clientIp(req: IncomingMessage, trustProxy?: boolean | number): string {
  const socketAddress: string = req.socket?.remoteAddress as string;
  const header: string | string[] | undefined = req.headers['x-forwarded-for'];
  if (!trustProxy || !header) {
    return socketAddress;
  }
  const forwarded: string[] = (Array.isArray(header) ? header.join(',') : header)
    .split(',')
    .map((address: string) => address.trim())
    .filter(Boolean);
  if (!forwarded.length) {
    return socketAddress;
  }
  if (trustProxy === true) {
    return forwarded[0];
  }
  // [client, proxy1, ..., socket]: step back trustProxy hops from the socket, never past the client
  const chain: string[] = [
    ...forwarded,
    socketAddress,
  ];
  return chain[Math.max(0, chain.length - 1 - trustProxy)];
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

  // CORS header values that do not depend on the request, built on first use
  private corsStatic?: Record<string, string>;
  private corsMethods: WeakMap<string[], { count: number; value: string }> = new WeakMap();

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

  protected respond(res: ServerResponse, response: Response<any>, backgroundHeaders?: Record<string, string>) {
    let responseBody: any;
    const { statusCode, body } = response;
    const responseHeaders: Record<string, string> = response.headers || {};
    const headers: Record<string, string> = {};
    let contentType: string | undefined;
    let hasContentLength: boolean = false;
    for (const source of [
      this.options.headers,
      backgroundHeaders,
      responseHeaders,
    ]) {
      for (const name in source) {
        headers[name] = source[name];
      }
    }
    for (const name in responseHeaders) {
      // only names of a matching length are lower-cased
      const lower: string = name.length === 12 || name.length === 14 || name.length === 17 ? name.toLowerCase() : '';
      if (lower === 'content-type' && contentType === undefined) {
        contentType = responseHeaders[name];
      } else if (lower === 'content-length' || lower === 'transfer-encoding') {
        hasContentLength = true;
      }
    }
    // cheapest checks first: most bodies are plain objects, strings or buffers
    const isRawBody: boolean =
      body === undefined ||
      body === null ||
      typeof body === 'string' ||
      Buffer.isBuffer(body) ||
      body instanceof Uint8Array;
    const isStreamBody: boolean = !isRawBody && typeof body.pipe === 'function' && isReadableStream(body);
    if (isStreamBody) {
      responseBody = body;
    } else if (contentType !== undefined && contentType.startsWith(ContentType.JSON)) {
      responseBody = JSON.stringify(body);
    } else if (!isRawBody) {
      // res.end() only accepts strings and buffers: serialise anything else as JSON
      if (!contentType) {
        headers['Content-Type'] = ContentType.JSON;
      }
      responseBody = JSON.stringify(body);
    } else {
      responseBody = body;
    }
    // A known length avoids Transfer-Encoding: chunked (extra framing on every response).
    // 1xx/204/304 must not carry one; streams keep chunked encoding.
    if (!isStreamBody && !hasContentLength && statusCode >= 200 && statusCode !== 204 && statusCode !== 304) {
      headers['Content-Length'] =
        responseBody === undefined || responseBody === null
          ? '0'
          : typeof responseBody === 'string'
            ? String(Buffer.byteLength(responseBody))
            : String(responseBody.byteLength);
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
      const ip: string = clientIp(req, this.options.trustProxy);
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
      const queryIndex: number = url.indexOf('?');
      const uri: string = queryIndex === -1 ? url : url.slice(0, queryIndex);
      const queryString: string = queryIndex === -1 ? '' : url.slice(queryIndex + 1);
      const route = router.match(method as HttpMethod, clearRoutePath(uri));
      let backgroundHeaders: Record<string, string> | undefined;
      if (enableCors) {
        backgroundHeaders = this.corsHeaders(route?.allowedMethods, origin);
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

        // without declared query fields the query is dropped by validation anyway
        if (queryString && (context.options?.allowUnknownFields || hasKeys(context.request.query))) {
          query = queryParser(queryString);
        }

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
          const error: AladoServerError | undefined = validateRequestFiles(context, request);
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

  protected corsHeaders(allowedMethods: string[] | undefined, origin: string): Record<string, string> {
    const cors = this.options.router.options.cors;
    if (!this.corsStatic) {
      this.corsStatic = {
        'Access-Control-Allow-Headers': cors?.allowedHeaders?.join(', ') || '',
        'Access-Control-Expose-Headers': cors?.exposeHeaders?.join(', ') || '',
        'Access-Control-Allow-Credentials': cors?.allowedCredentials ? 'true' : 'false',
      };
    }
    let methods: string = '';
    if (allowedMethods) {
      // the array grows while routes are registered, so the cache is keyed on its length too
      let cached = this.corsMethods.get(allowedMethods);
      if (!cached || cached.count !== allowedMethods.length) {
        cached = { count: allowedMethods.length, value: allowedMethods.join(', ') };
        this.corsMethods.set(allowedMethods, cached);
      }
      methods = cached.value;
    }
    const headers: Record<string, string> = {
      'Access-Control-Allow-Methods': methods,
      ...this.corsStatic,
    };
    if (Array.isArray(cors.allowedOrigin)) {
      if (cors.allowedOrigin.includes(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
      }
    } else {
      headers['Access-Control-Allow-Origin'] = (cors.allowedOrigin as string) || origin;
    }
    return headers;
  }

  protected logError(e: Error) {
    if (this.options.verbose) {
      this.options.logger?.error(e);
    }
  }
}
