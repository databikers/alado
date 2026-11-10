import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Router } from '../../src/router';
import { AladoConfigurationError } from '../../src/dto';
import { HttpMethod } from '../../src/constants';
import { validate } from '../../src';

const makeRouter = () =>
  new Router(
    { cors: { enable: false, allowedMethods: new Map() }, openApiDoc: undefined, logger: { log() {} } } as any,
    {},
  );
const field = () => ({
  validation: { required: true, handler: validate.string().build(), error: { statusCode: 400, message: 'bad' } },
});
const fileField = () => ({
  mimetypes: ['text/plain'],
  maxSize: 1024,
  required: true,
  mimetypeError: { statusCode: 400, message: 'type' },
  maxSizeError: { statusCode: 413, message: 'size' },
  requiredError: { statusCode: 400, message: 'required' },
});
const ok = () => ({ statusCode: 204 });
const base: any = { title: 't', options: { allowUnknownFields: false }, response: { statusCode: 204 } };
const auth = (inputProperty: string) => ({
  inputProperty,
  outputProperty: 'auth',
  handler: async () => ({}),
  error: { statusCode: 401, message: 'no' },
});

const refuses = (method: HttpMethod, context: any, readers: string) =>
  assert.throws(
    () => makeRouter().use(method, '/items/:id', context, ok),
    (e: any) =>
      e instanceof AladoConfigurationError &&
      e.code === 'BODY_NOT_ALLOWED' &&
      e.message.includes(`${method} /items/:id`) &&
      e.message.includes(`(${readers})`),
  );

describe('a body declared on a method without a body', () => {
  for (const method of [
    HttpMethod.GET,
    HttpMethod.HEAD,
    HttpMethod.DELETE,
    HttpMethod.OPTIONS,
  ]) {
    it(`${method}: refuses body and files fields`, () => {
      refuses(method, { ...base, request: { body: { reason: field() } } }, 'body.reason');
      refuses(method, { ...base, request: { files: { doc: fileField() } } }, 'files.doc');
    });
  }

  it('refuses auth and access rules that read the body', () => {
    refuses(HttpMethod.DELETE, { ...base, request: {}, auth: auth('body.token') }, 'body.token');
    refuses(
      HttpMethod.GET,
      {
        ...base,
        request: {},
        accessControl: [
          {
            inputProperty: 'path.id',
            compareWithProperty: 'body.owner',
            statusCode: 403,
            message: 'no',
          },
        ],
      },
      'body.owner',
    );
  });

  it('accepts the same declarations on POST, PUT, PATCH and QUERY', () => {
    for (const method of [
      HttpMethod.POST,
      HttpMethod.PUT,
      HttpMethod.PATCH,
      HttpMethod.QUERY,
    ]) {
      makeRouter().use(method, '/items/:id', { ...base, request: { body: { reason: field() } } }, ok);
    }
  });

  it('accepts a DELETE without a body, also with allowUnknownFields', () => {
    makeRouter().use(HttpMethod.DELETE, '/items/:id', { ...base, request: {} }, ok);
    makeRouter().use(
      HttpMethod.DELETE,
      '/items/:id',
      { ...base, options: { allowUnknownFields: true }, request: { query: { force: field() } } },
      ok,
    );
  });
});

describe('route parameter names', () => {
  const refused = (path: string, text: RegExp) =>
    assert.throws(
      () => makeRouter().use(HttpMethod.GET, path, { ...base, request: {} }, ok),
      (e: any) => e instanceof AladoConfigurationError && e.code === 'INVALID_PATH_PARAMETER' && text.test(e.message),
      path,
    );

  it('refuses a parameter declared twice in one path', () => {
    refused('/orgs/:id/users/:id', /parameter ":id" is declared twice/);
  });

  it('refuses a name that swallowed the text after it', () => {
    refused('/files/:name.json', /parameter ":name\.json" should be a name/);
    refused('/range/:from..:to', /should be a name/);
    refused('/x/:1st', /should be a name/);
  });

  it('accepts ordinary names, also after a literal prefix', () => {
    for (const path of [
      '/users/:id',
      '/users/:user_id/posts/:post-id',
      '/api/v:version/items',
      '/a/:A1',
    ]) {
      makeRouter().use(HttpMethod.GET, path, { ...base, request: {} }, ok);
    }
  });
});
