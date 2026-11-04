import { IncomingMessage, ServerResponse } from 'http';
import { join } from 'path';
import { createReadStream, readdirSync, readFileSync } from 'fs';
import { Readable, pipeline } from 'stream';

import { ContentType, HttpMethod, SWAGGER_INITIALIZER_FILE_NAME } from '@const';
import { RequestProcessorOptions } from '@options';
import { AladoServerError, Context, ContextRequest, Request, Response } from '@dto';
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
const SWAGGER_JSON_PATH: string = '/swagger.json';

/**
 * Maps a request path (already through clearRoutePath, query string removed) to a Swagger UI
 * file name, or undefined if it is not one. Files are only served under the docs route; the docs
 * page sets <base href="<route>/"> so its relative asset URLs resolve there. Only a docs route of
 * "/" serves files from the root. The result is always an exact entry of the swagger-ui-dist
 * listing, so no part of the URL ever reaches the filesystem (no `..`, no subdirectories).
 */
export function resolveSwaggerUiFile(pathname: string, docsRoute: string): string | undefined {
  const route: string = clearRoutePath(docsRoute || '');
  let name: string | undefined;
  if (pathname === route || (!route && pathname === '')) {
    name = 'index.html';
  } else if (pathname.startsWith(`${route}/`)) {
    name = pathname.slice(route.length + 1);
  }
  return name !== undefined && swaggerUiFiles.has(name) ? name : undefined;
}

const swaggerContentTypes: Record<string, string> = {
  css: 'text/css; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  map: 'application/json; charset=utf-8',
  html: 'text/html; charset=utf-8',
  png: 'image/png',
};

const htmlAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Swagger UI's index.html, with a <base> so its relative asset URLs stay under the docs route. */
export function swaggerIndexHtml(html: string, docsRoute: string): string {
  const base: string = `<base href="${htmlAttribute(`${clearRoutePath(docsRoute || '')}/`)}" />`;
  return html.replace(/<head([^>]*)>/i, (head: string) => `${head}\n    ${base}`);
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

const queryReaders: WeakMap<Context<any>, boolean> = new WeakMap();
const queryPathRegExp: RegExp = /^query(\.|\[|$)/;

function readsQuery(context: Context<any>): boolean {
  let reads: boolean | undefined = queryReaders.get(context);
  if (reads === undefined) {
    const paths: string[] = [
      context.auth?.inputProperty,
      ...(context.accessControl || []).flatMap((rule) => [
        rule.inputProperty,
        rule.compareWithProperty,
      ]),
    ].filter((path): path is string => typeof path === 'string');
    reads =
      Boolean(context.options?.allowUnknownFields) ||
      hasKeys(context.request.query) ||
      paths.some((path: string) => queryPathRegExp.test(path));
    queryReaders.set(context, reads);
  }
  return reads;
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

/**
 * Adds a Vary token without dropping one the handler set: every spelling of the header name
 * (Vary, vary, ...) is folded into a single Vary header, the handler's tokens first.
 */
function mergeVary(headers: Record<string, string>, token: string) {
  const tokens: string[] = [];
  for (const name of Object.keys(headers)) {
    if (name.length === 4 && name.toLowerCase() === 'vary') {
      if (name !== 'Vary' || headers[name] !== token) {
        tokens.push(...String(headers[name]).split(','));
      }
      delete headers[name];
    }
  }
  const values: string[] = tokens.map((t: string) => t.trim()).filter(Boolean);
  const lower: string[] = values.map((t: string) => t.toLowerCase());
  if (!lower.includes('*') && !lower.includes(token.toLowerCase())) {
    values.push(token);
  }
  headers.Vary = values.join(', ');
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

  private swaggerIndex: string = '';
  private swaggerInitializer: string = '';
  // CORS header values that do not depend on the request, built on first use
  private corsStatic?: Record<string, string>;
  private corsMethods: WeakMap<string[], { count: number; value: string }> = new WeakMap();

  constructor(requestProcessorOptions: RequestProcessorOptions) {
    this.options = requestProcessorOptions;
    if (requestProcessorOptions.openApiDoc?.enable) {
      swaggerUiAssetPath = require('swagger-ui-dist').absolutePath();
      // Only web assets directly inside swagger-ui-dist are ever served (not its package.json, README, LICENSE)
      swaggerUiFiles = new Set(
        readdirSync(swaggerUiAssetPath, { withFileTypes: true })
          .filter((entry) => entry.isFile() && swaggerContentTypes[entry.name.slice(entry.name.lastIndexOf('.') + 1)])
          .map((entry) => entry.name),
      );
      // the two files that are rewritten are built once, not read from disk on every request
      this.swaggerIndex = swaggerIndexHtml(
        readFileSync(join(swaggerUiAssetPath, 'index.html'), 'utf8'),
        requestProcessorOptions.openApiDoc.route as string,
      );
      this.swaggerInitializer = readFileSync(join(swaggerUiAssetPath, SWAGGER_INITIALIZER_FILE_NAME), 'utf8').replace(
        'https://petstore.swagger.io/v2/swagger.json',
        SWAGGER_JSON_PATH,
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
    if (backgroundHeaders?.Vary) {
      mergeVary(headers, backgroundHeaders.Vary);
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
    if (isStreamBody) {
      this.sendStream(res, statusCode, headers, responseBody, backgroundHeaders);
      return;
    }
    res.writeHead(statusCode, headers);
    res.end(responseBody);
  }

  protected sendStream(
    res: ServerResponse,
    statusCode: number,
    headers: Record<string, string>,
    stream: Readable,
    backgroundHeaders?: Record<string, string>,
  ) {
    const start = (): void => {
      stream.removeListener('error', failBeforeStart);
      res.writeHead(statusCode, headers);
      pipeline(stream, res, (error?: Error | null) => {
        if (error) {
          this.logError(error);
        }
      });
    };
    const failBeforeStart = (error: NodeJS.ErrnoException): void => {
      stream.removeListener('ready', start);
      this.logError(error);
      this.respondError(
        res,
        error.code === 'ENOENT' ? { statusCode: 404, message: 'Not Found' } : toClientError(error),
        backgroundHeaders,
      );
    };
    if ((stream as Readable & { pending?: boolean }).pending === true) {
      stream.once('ready', start);
      stream.once('error', failBeforeStart);
      return;
    }
    start();
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
      // only the path is normalised: the query string reaches the parser byte for byte
      // (collapsing '//' or dropping a trailing '/' would change values such as URLs or base64 tokens)
      const rawUrl: string = req.url as string;
      const queryIndex: number = rawUrl.indexOf('?');
      const uri: string = clearRoutePath(queryIndex === -1 ? rawUrl : rawUrl.slice(0, queryIndex));
      const queryString: string = queryIndex === -1 ? '' : rawUrl.slice(queryIndex + 1);
      const url: string = queryIndex === -1 ? uri : `${uri || '/'}?${queryString}`;
      const ip: string = clientIp(req, this.options.trustProxy);
      const origin: string = (req.headers.origin as string) || '*';
      // Process Open API routes
      if (openApiDoc?.enable && method === HttpMethod.GET) {
        const pathname: string = uri;
        if (pathname === SWAGGER_JSON_PATH) {
          return this.respond(res, {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: this.options.router.openApiDocObject,
          });
        }
        const swaggerFile: string | undefined = resolveSwaggerUiFile(pathname, openApiDoc.route as string);
        if (swaggerFile === 'index.html') {
          return this.respond(res, {
            statusCode: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
            body: this.swaggerIndex,
          });
        }
        if (swaggerFile === SWAGGER_INITIALIZER_FILE_NAME) {
          return this.respond(res, {
            statusCode: 200,
            headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
            body: this.swaggerInitializer,
          });
        }
        if (swaggerFile) {
          // swaggerFile is a bare name from the swagger-ui-dist listing, never a path from the URL
          const extension: string = swaggerFile.slice(swaggerFile.lastIndexOf('.') + 1);
          return this.respond(res, {
            statusCode: 200,
            headers: { 'Content-Type': swaggerContentTypes[extension] },
            body: createReadStream(join(swaggerUiAssetPath, swaggerFile)),
          });
        }
      }
      // Process API routes
      const route = router.match(method as HttpMethod, uri);
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
          const r = await bodyParser(
            req,
            res,
            this.options.maxBodySizeBytes as number,
            Boolean(context.options?.allowUnknownFields) || hasKeys(context.request.files),
          );
          body = r.body;
          rawBody = r.rawBody;
          files = r.files;
        }

        if (queryString && readsQuery(context)) {
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
    // The response depends on the Origin header whenever the allowed origin is not fixed (also when this
    // origin is refused): without Vary, a shared cache would hand one origin's response to another.
    if (Array.isArray(cors.allowedOrigin) || !cors.allowedOrigin) {
      headers.Vary = 'Origin';
    }
    return headers;
  }

  protected logError(e: Error) {
    if (this.options.verbose) {
      this.options.logger?.error(e);
    }
  }
}
