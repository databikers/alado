import { IncomingMessage, ServerResponse } from 'http';
import { join } from 'path';
import { createReadStream, readFileSync } from 'fs';
import { Readable, pipeline } from 'stream';
import { isIP } from 'net';

import { ContentType, HttpMethod, SWAGGER_INITIALIZER_FILE_NAME } from '@const';
import { RequestProcessorOptions } from '@options';
import { AladoServerError, Context, ContextRequest, Request, Response } from '@dto';
import {
  accessControlChecker,
  authenticate,
  bodyMethods,
  bodyParser,
  bodyReaders,
  queryParser,
  clearRoutePath,
  isReadableStream,
  validateRequestFiles,
  validateRequestPart,
  openApiJsonPath,
  swaggerContentTypes,
  swaggerUiAssetPath,
  swaggerUiFileNames,
  safeLog,
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

/**
 * How an exception from an auth handler is logged. One that carries a 4xx `statusCode`
 * ({ statusCode: 401 }, or an Error with it) is the handler refusing credentials: logged like other
 * client errors, with `verbose` only, so a stream of bad tokens does not flood the log. Anything
 * else (a database down, a bug) is a failure of the handler and is always logged.
 */
export function authHandlerErrorStatus(e: any): number {
  const statusCode: unknown = e?.statusCode;
  return typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500 ? statusCode : 500;
}

function hasKeys(value: any): boolean {
  for (const _ in value) {
    return true;
  }
  return false;
}

const bodyPathRegExp: RegExp = /^(body|rawBody|files)(\.|\[|$)/;
// where the body has to be read: before authentication or access control when they read it,
// otherwise after both, so a refused request never has its body read and parsed. 'none': the route
// declares nothing that reads it (no body or files fields, no allowUnknownFields), so it is not read
type BodyStage = 'auth' | 'accessControl' | 'validation' | 'none';
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
        : context.options?.allowUnknownFields || bodyReaders(context).length
          ? 'validation'
          : 'none';
    bodyStages.set(context, stage);
  }
  return stage;
}

/**
 * Called before the status line goes out. A body that was never read is still on the socket, and
 * Node reads it to the end to keep the connection: harmless for a body within maxBodySizeBytes (a
 * client sending `{}` with every DELETE keeps its connection), but the limit does not apply there.
 * A larger body, a chunked one (its size is unknown) or any body without a limit closes the
 * connection after the response instead, so no more of it is read.
 */
export function settleUnreadBody(req: IncomingMessage, res: ServerResponse, limit: number): void {
  if (req.complete || res.headersSent) {
    return;
  }
  const declared: string | undefined = req.headers['content-length'];
  const chunked: boolean = req.headers['transfer-encoding'] !== undefined;
  if (!chunked && (declared === undefined || declared === '0')) {
    return;
  }
  if (chunked || !limit || !(Number(declared) <= limit)) {
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

const bracketedIpv6WithPort: RegExp = /^\[([0-9a-fA-F:.]+)\](?::\d{1,5})?$/;
const ipv4WithPort: RegExp = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/;

/**
 * An X-Forwarded-For entry as an IP address, or undefined. The header is text a client can write,
 * so request.ip only ever takes a value that is an address (net.isIP); "203.0.113.7:51234" and
 * "[2001:db8::1]:443", which some proxies write, give the address without the port.
 */
export function forwardedAddress(entry: string): string | undefined {
  if (isIP(entry)) {
    return entry;
  }
  const match: RegExpExecArray | null = bracketedIpv6WithPort.exec(entry) || ipv4WithPort.exec(entry);
  return match && isIP(match[1]) ? match[1] : undefined;
}

const absoluteForm: RegExp = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]*/;

/**
 * The path and query of a request target. Clients normally send "/items?x=1" (origin-form), but
 * "http://host/items?x=1" (absolute-form) is valid too and must be accepted (RFC 9112 3.2.2); some
 * proxies and older clients send it. The scheme and host are dropped; an empty path is "/".
 */
export function requestTarget(url: string): string {
  if (url.charCodeAt(0) === 47) {
    return url;
  }
  const match: RegExpExecArray | null = absoluteForm.exec(url);
  if (!match) {
    return url;
  }
  const rest: string = url.slice(match[0].length);
  return rest.charCodeAt(0) === 47 ? rest : `/${rest}`;
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
    // the left-most address; entries that are not addresses are skipped, never returned
    for (const entry of forwarded) {
      const address: string | undefined = forwardedAddress(entry);
      if (address) {
        return address;
      }
    }
    return socketAddress;
  }
  // [client, proxy1, ..., socket]: step back trustProxy hops from the socket, never past the client
  const chain: string[] = [
    ...forwarded,
    socketAddress,
  ];
  const selected: string = chain[Math.max(0, chain.length - 1 - trustProxy)];
  return selected === socketAddress ? selected : (forwardedAddress(selected) ?? socketAddress);
}

/**
 * Response headers from the server options, CORS and the handler, later sources winning. Header
 * names are case-insensitive: a handler's `access-control-allow-origin` replaces the CORS
 * `Access-Control-Allow-Origin` instead of going out next to it (two values make browsers refuse
 * the response). Names are only folded when more than one source has headers, the rare case.
 */
export function mergeHeaders(
  server: Record<string, string> | undefined,
  cors: Record<string, string> | undefined,
  handler: Record<string, string> | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {};
  const hasServer: boolean = hasKeys(server);
  const hasCors: boolean = hasKeys(cors);
  const hasHandler: boolean = hasKeys(handler);
  if ((hasServer ? 1 : 0) + (hasCors ? 1 : 0) + (hasHandler ? 1 : 0) <= 1) {
    // one source (the common case): a plain copy, the caller adds headers to it
    const only: Record<string, string> | undefined = hasHandler ? handler : hasCors ? cors : server;
    for (const name in only) {
      headers[name] = only[name];
    }
    return headers;
  }
  // lower-cased name -> the spelling currently in `headers`
  const spelling: Map<string, string> = new Map();
  for (const source of [
    server,
    cors,
    handler,
  ]) {
    for (const name in source) {
      const lower: string = name.toLowerCase();
      const previous: string | undefined = spelling.get(lower);
      if (previous !== undefined && previous !== name) {
        delete headers[previous];
      }
      spelling.set(lower, name);
      headers[name] = (source as Record<string, string>)[name];
    }
  }
  return headers;
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
    const headers: Record<string, string> = mergeHeaders(this.options.headers, backgroundHeaders, responseHeaders);
    let contentType: string | undefined;
    let hasContentLength: boolean = false;
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
    if (res.req) {
      settleUnreadBody(res.req, res, this.options.maxBodySizeBytes as number);
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
      if (res.req?.method === HttpMethod.HEAD) {
        // a HEAD response has no body: close the stream (and its file) without reading it
        stream.destroy();
        res.end();
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

  /**
   * The request listener given to http.createServer. Node ends the process on a rejected promise, so
   * nothing thrown while a request is handled may leave here: whatever escapes handle() answers 500
   * when the status line is not out yet, otherwise the connection is dropped.
   */
  public process(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // a .catch on handle()'s own promise: no extra async frame on every request
    return this.handle(req, res).catch((e: unknown) => {
      this.logError(e as Error, 500);
      try {
        this.respondError(res, { statusCode: 500, message: 'Internal Server Error' });
      } catch {
        res.destroy();
      }
    });
  }

  protected async handle(req: IncomingMessage, res: ServerResponse) {
    // declared outside the try: an error thrown after the route is matched (an invalid or oversized
    // body, ...) still has to carry the CORS headers, or a browser client cannot read it
    let backgroundHeaders: Record<string, string> | undefined;
    try {
      const { router, openApiDoc, enableCors } = this.options;
      const { headers, method } = req;
      // only the path is normalised: the query string reaches the parser byte for byte
      // (collapsing '//' or dropping a trailing '/' would change values such as URLs or base64 tokens)
      const rawUrl: string = requestTarget(req.url as string);
      const queryIndex: number = rawUrl.indexOf('?');
      const uri: string = clearRoutePath(queryIndex === -1 ? rawUrl : rawUrl.slice(0, queryIndex));
      const queryString: string = queryIndex === -1 ? '' : rawUrl.slice(queryIndex + 1);
      const url: string = queryIndex === -1 ? uri : `${uri || '/'}?${queryString}`;
      const ip: string = clientIp(req, this.options.trustProxy);
      const origin: string = (req.headers.origin as string) || '*';
      // Process Open API routes (HEAD as GET: same status and headers, the body is not sent)
      if (openApiDoc?.enable && (method === HttpMethod.GET || method === HttpMethod.HEAD)) {
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
      // HEAD without a HEAD route: the GET route answers, and the body is not sent (RFC 9110 9.3.2)
      const route =
        router.match(method as HttpMethod, uri) ??
        (method === HttpMethod.HEAD ? router.match(HttpMethod.GET, uri) : undefined);
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
        let bodyRead: boolean = !bodyMethods.has(method as string) || stage === 'none';
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
            this.options.parsing?.repeatedFiles,
          );
          // a JSON body may be false, 0, "" or null: a value the client sent, not a missing body
          if (r.body !== undefined) {
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
            this.logError(e as Error, authHandlerErrorStatus(e)),
          );
          if (authError) {
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
    // sync or async, a logger that fails reports to the console and never ends the process
    safeLog(this.options.logger, 'error', e);
  }
}
