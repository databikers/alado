import { IncomingMessage, ServerResponse } from 'http';
import { join } from 'path';
import { access, constants, createReadStream, readdirSync } from 'fs';

import { ContentType, HttpMethod } from '@const';
import { RequestProcessorOptions } from '@options';
import { AladoServerError, ContextRequest, Request, Response } from '@dto';
import {
  authenticate,
  bodyParser,
  queryParser,
  clearRoutePath,
  isReadableStream,
  validateRequestFiles,
  validateRequestPart,
  mergeHeaders,
} from '@helper';

const swaggerUiAssetPath = require('swagger-ui-dist').absolutePath();
const swaggerUiFiles: string[] = readdirSync(swaggerUiAssetPath);

export class RequestProcessor {
  private readonly options: RequestProcessorOptions;

  constructor(requestProcessorOptions: RequestProcessorOptions) {
    this.options = requestProcessorOptions;
  }

  protected respond(res: ServerResponse, response: Response<any>) {
    let responseBody: any;
    const { statusCode, headers, body } = response;
    const isStreamBody = isReadableStream(body);
    const contentType: string = headers['Content-Type'] || headers['content-type'];
    switch (contentType) {
      case ContentType.JSON:
        responseBody = isStreamBody ? body : JSON.stringify(body);
        break;
      default:
        responseBody = body;
        break;
    }
    res.writeHead(statusCode, { ...this.options.headers, ...headers });
    if (isStreamBody) {
      responseBody.pipe(res);
    } else {
      res.end(responseBody);
    }
  }

  protected respondError(res: ServerResponse, error: AladoServerError) {
    const { statusCode, message } = error;
    return this.respond(res, {
      statusCode,
      headers: { ...this.options.headers, 'Content-Type': 'application/json' },
      body: { message },
    });
  }

  public async process(req: IncomingMessage, res: ServerResponse) {
    try {
      const { router, openApiDoc, enableCors } = this.options;
      const { headers, method } = req;
      const url = clearRoutePath(req.url);
      // Process Open API routes
      if (openApiDoc?.enable) {
        if (method === HttpMethod.GET) {
          if (
            !req.url.startsWith(`/swagger.json`) &&
            ((url.startsWith(clearRoutePath(openApiDoc?.route)) &&
              ![
                '',
                '/',
              ].includes(openApiDoc?.route)) ||
              swaggerUiFiles.includes(url.replace('/', '')) ||
              url === openApiDoc?.route)
          ) {
            let filePath = join(swaggerUiAssetPath, url.replace(`${clearRoutePath(openApiDoc.route)}`, ''));
            filePath += url === clearRoutePath(openApiDoc.route) ? '/index.html' : '';
            return access(filePath, constants.F_OK, (err) => {
              if (err) {
                return this.respond(res, {
                  statusCode: 404,
                  headers: { 'Content-Type': 'text/plain' },
                  body: 'Not Found',
                });
              } else {
                createReadStream(filePath).pipe(res);
              }
            });
          } else if (req.url.startsWith(`/swagger.json`)) {
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

      if (!route) {
        // Not Found
        return this.respondError(res, { statusCode: 404, message: 'Not Found' });
      } else {
        // CORS
        if (enableCors && method === HttpMethod.OPTIONS) {
          const response: Response<any> = await route.handler({});
          return this.respond(res, response);
        }

        const { context, handler, path } = route;

        // Process request, prepare data
        let body: any = {};
        let rawBody: string = '';
        let query: any = {};
        let files: any = {};

        if (
          (context.request.body || context.request.files) &&
          (
            [
              HttpMethod.PUT,
              HttpMethod.PATCH,
              HttpMethod.POST,
            ] as string[]
          ).includes(method)
        ) {
          const r = await bodyParser(req);
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
          const authError = await authenticate(context, request);
          if (authError) {
            return this.respondError(res, authError);
          }
        }
        // Validate request
        for (const key in context.request) {
          const error = await validateRequestPart(key as keyof ContextRequest, context, request);
          if (error) {
            return this.respondError(res, error);
          }
        }
        // Validate request (files)
        if (context.request.files) {
          const error = await validateRequestFiles(context, request);
          if (error) {
            return this.respondError(res, error);
          }
        }
        try {
          const response: Response<any> = await handler(request);
          return this.respond(res, response);
        } catch (e) {
          return this.respondError(res, { statusCode: 500, message: e.message });
        }
      }
    } catch (e) {
      return this.respondError(res, { statusCode: 400, message: e.message });
    }
  }
}
