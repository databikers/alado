import { IncomingMessage, ServerResponse } from 'http';
import { join } from 'path';
import { createReadStream, readFileSync } from 'fs';
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
  openApiJsonPath,
  swaggerContentTypes,
  swaggerUiAssetPath,
  swaggerUiFileNames,
} from '@helper';

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
  return name !== undefined && swaggerUiFileNames().has(name) ? name : undefined;
}

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

const bodyPathRegExp: RegExp = /^(body|rawBody|files)(\.|\[|$)/;
// where the body has to be read: before authentication or access control when they read it,
// otherwise after both, so a refused request never has its body read and parsed
type BodyStage = 'auth' | 'accessControl' | 'validation';
const bodyStages: WeakMap<Context<any>, BodyStage> = new WeakMap();

function bodyStage(context: Context<any>): BodyStage {
  let stage: BodyStage | undefined = bodyStages.get(context);
  if (stage === undefined) {
    const accessControlPaths: unknown[] = (context.accessControl || []).flatMap((rule) => [
      rule.inputProperty,
      rule.compareWithProperty,
    ]);
    const reads = (path: unknown): boolean => typeof path === 'string' && bodyPathRegExp.test(path);
    stage = reads(context.auth?.inputProperty)
      ? 'auth'
      : accessControlPaths.some(reads)
        ? 'accessControl'
        : 'validation';
    bodyStages.set(context, stage);
  }
  return stage;
}

// a body is on its way that will not be read: close the connection after the response instead
// of letting the client keep sending it
function closeIfBodyUnread(req: IncomingMessage, res: ServerResponse, bodyRead: boolean): void {
  const pending: boolean =
    req.headers['transfer-encoding'] !== undefined ||
    (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0');
  if (!bodyRead && pending && !res.headersSent) {
    res.setHeader('Connection', 'close');
  }
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
  private swaggerJsonPath: string = '';
  private corsMethods: WeakMap<string[], { count: number; value: string }> = new WeakMap();

  constructor(requestProcessorOptions: RequestProcessorOptions) {
    this.options = requestProcessorOptions;
    if (requestProcessorOptions.openApiDoc?.enable) {
      const swaggerUiDirectory: string = swaggerUiAssetPath();
      // the document is served under the docs route, so it never takes a path of the API at the root
      this.swaggerJsonPath = openApiJsonPath(requestProcessorOptions.openApiDoc.route as string);
      // the two files that are rewritten are built once, not read from disk on every request
      this.swaggerIndex = swaggerIndexHtml(
        readFileSync(join(swaggerUiDirectory, 'index.html'), 'utf8'),
        requestProcessorOptions.openApiDoc.route as string,
      );
      this.swaggerInitializer = readFileSync(join(swaggerUiDirectory, SWAGGER_INITIALIZER_FILE_NAME), 'utf8').replace(
        'https://petstore.swagger.io/v2/swagger.json',
        this.swaggerJsonPath,
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
    } else if (
      contentType !== undefined &&
      contentType.startsWith(ContentType.JSON) &&
      // a string or bytes under a JSON Content-Type is an already serialised document
      !(typeof body === 'string' || Buffer.isBuffer(body) || body instanceof Uint8Array)
    ) {
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

  /**
   * Streams a body. A pending stream (fs.createReadStream) starts in its 'ready' event, outside the
   * request's try/catch: anything thrown there, such as writeHead() refusing a header value built
   * from request data ("filename=\"a\nb\""), would end the process. Every listener here catches,
   * answers 500 when the status line is not out yet, and destroys the stream so its file is closed.
   */
  protected sendStream(
    res: ServerResponse,
    statusCode: number,
    headers: Record<string, string>,
    stream: Readable,
    backgroundHeaders?: Record<string, string>,
  ) {
    const fail = (error: unknown, clientError: AladoServerError): void => {
      stream.destroy();
      this.logError(error as Error, clientError.statusCode);
      try {
        this.respondError(res, clientError, backgroundHeaders);
      } catch (e) {
        // not even the error response could be written: drop the connection, keep the process
        this.logError(e as Error, 500);
        res.destroy();
      }
    };
    const start = (): void => {
      stream.removeListener('error', failBeforeStart);
      try {
        res.writeHead(statusCode, headers);
      } catch (error) {
        fail(error, { statusCode: 500, message: 'Internal Server Error' });
        return;
      }
      pipeline(stream, res, (error?: NodeJS.ErrnoException | null) => {
        if (error) {
          // the client going away mid-response is not a server failure
          this.logError(error, error.code === 'ERR_STREAM_PREMATURE_CLOSE' ? 499 : 500);
        }
      });
    };
    const failBeforeStart = (error: NodeJS.ErrnoException): void => {
      stream.removeListener('ready', start);
      fail(error, error.code === 'ENOENT' ? { statusCode: 404, message: 'Not Found' } : toClientError(error));
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
    // declared outside the try: an error thrown after the route is matched (an invalid or oversized
    // body, ...) still has to carry the CORS headers, or a browser client cannot read it
    let backgroundHeaders: Record<string, string> | undefined;
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
        if (pathname === this.swaggerJsonPath) {
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
            body: createReadStream(join(swaggerUiAssetPath(), swaggerFile)),
          });
        }
      }
      // Process API routes
      const route = router.match(method as HttpMethod, uri);
      if (enableCors) {
        backgroundHeaders = this.corsHeaders(route?.allowedMethods, origin);
      }
      if (!route) {
        // the path exists for other methods: 405 with the methods it does accept (RFC 9110 15.5.6)
        const allowed: HttpMethod[] = router.methodsFor(uri);
        if (allowed.length) {
          return this.respondError(
            res,
            { statusCode: 405, message: 'Method Not Allowed' },
            { ...backgroundHeaders, Allow: allowed.join(', ') },
          );
        }
        // Not Found
        return this.respondError(res, { statusCode: 404, message: 'Not Found' }, backgroundHeaders);
      } else {
        // CORS
        if (enableCors && method === HttpMethod.OPTIONS) {
          const response: Response<any> = await route.handler({ request: req, origin } as Request);
          return this.respond(res, response, backgroundHeaders);
        }

        const { context, handler, path } = route;

        // Process request, prepare data
        let query: any = {};

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
          body: {},
          files: {},
        };
        const stage: BodyStage = bodyStage(context);
        let bodyRead: boolean = !bodyMethods.has(method as string);
        const readBody = async (): Promise<void> => {
          if (bodyRead) {
            return;
          }
          bodyRead = true;
          const r = await bodyParser(
            req,
            res,
            this.options.maxBodySizeBytes as number,
            Boolean(context.options?.allowUnknownFields) || hasKeys(context.request.files),
          );
          if (r.body) {
            request.body = r.body;
          } else {
            delete request.body;
          }
          const rawBody: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(r, 'rawBody');
          if (rawBody?.get) {
            // multipart: the text is built only if something reads request.rawBody
            Object.defineProperty(request, 'rawBody', rawBody);
          } else if (r.rawBody) {
            request.rawBody = r.rawBody;
          }
          request.files = r.files;
        };
        // Authenticate
        if (context.auth) {
          if (stage === 'auth') {
            await readBody();
          }
          const authError: AladoServerError = await authenticate(context, request, (e: unknown) =>
            // a thrown auth handler is a failure of the handler, not of the credentials
            this.logError(e as Error, 500),
          );
          if (authError) {
            closeIfBodyUnread(req, res, bodyRead);
            return this.respondError(res, authError, backgroundHeaders);
          }
        }
        // Access control
        if (Array.isArray(context.accessControl) && context.accessControl.length) {
          if (stage === 'accessControl') {
            await readBody();
          }
          const accessError = await accessControlChecker(context, request);
          if (accessError) {
            closeIfBodyUnread(req, res, bodyRead);
            return this.respondError(res, accessError, backgroundHeaders);
          }
        }
        await readBody();
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
          const clientError = toClientError(e);
          this.logError(e, clientError.statusCode);
          return this.respondError(res, clientError, backgroundHeaders);
        }
      }
    } catch (e: any) {
      const clientError = toClientError(e);
      this.logError(e as Error, clientError.statusCode);
      return this.respondError(res, clientError, backgroundHeaders);
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

  /**
   * Internal failures (5xx) are always logged: the client only gets a generic message, so the log
   * is the only place their cause shows up. Errors caused by the client (4xx thrown on purpose,
   * invalid or oversized bodies, a client leaving mid-response) are logged in verbose mode only.
   */
  protected logError(e: Error, statusCode: number) {
    if (statusCode < 500 && !this.options.verbose) {
      return;
    }
    const logger = this.options.logger;
    // `error` is optional in loggers that pass validation (only `log` is checked)
    if (typeof logger?.error === 'function') {
      logger.error(e);
    } else {
      logger?.log(e);
    }
  }
}
