import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  AladoServer,
  Request,
  RequestAuthentication,
  allOf,
  defineResponse,
  get,
  initializeApplication,
  post,
  withAuth,
} from '../../src';
import { baseOptions, close, listen, send, sendJson } from '../helpers/http';

const appId = 'auth-alternatives';
const json = { 'Content-Type': 'application/json' };
const doc = defineResponse({ statusCode: 200, headers: json, body: { ok: true } });

// how many times each handler ran, to see which strategies were tried
const calls: Record<string, number> = {};
const counted =
  (name: string, accept: (value: string) => unknown) =>
  async (value: string): Promise<unknown> => {
    calls[name] = (calls[name] || 0) + 1;
    if (value === 'explode') {
      throw new Error(`${name} store down`);
    }
    return accept(value);
  };

const bearer: RequestAuthentication = {
  inputProperty: 'headers.authorization',
  outputProperty: 'auth.user',
  handler: counted('bearer', (v) => (v === 'Bearer alice' ? { id: 1 } : null)),
  error: { statusCode: 401, message: 'Bad token' },
};
const apiKey: RequestAuthentication = {
  // declared in mixed case: header names are matched case-insensitively in every strategy
  inputProperty: 'headers.X-Api-Key',
  outputProperty: 'auth.client',
  handler: counted('apiKey', (v) => (v === 'key-1' ? { client: 'ci' } : null)),
  error: { statusCode: 401, message: 'Bad API key' },
};
const link: RequestAuthentication = {
  inputProperty: 'query.token',
  outputProperty: 'auth.link',
  handler: counted('link', (v) => (v === 'share-1' ? { shared: true } : null)),
  error: { statusCode: 403, message: 'Bad link' },
};
const bodyToken: RequestAuthentication = {
  inputProperty: 'body.token',
  outputProperty: 'auth.form',
  handler: counted('bodyToken', (v) => (v === 'form-1' ? { form: true } : null)),
  error: { statusCode: 401, message: 'Bad form token' },
};
const optionalBearer: RequestAuthentication = { ...bearer, required: false };
const optionalApiKey: RequestAuthentication = { ...apiKey, required: false };

const reply = (req: Request) => ({ statusCode: 200, headers: json, body: req.auth || {} });

class AlternativesController {
  @get('/any', { appId })
  @withAuth(bearer, apiKey)
  @doc
  async any(req: Request) {
    return reply(req);
  }

  @get('/both', { appId })
  @withAuth([
    apiKey,
    bearer,
  ])
  @doc
  async both(req: Request) {
    return reply(req);
  }

  @get('/both-helper', { appId })
  @withAuth(allOf(apiKey, bearer))
  @doc
  async bothHelper(req: Request) {
    return reply(req);
  }

  @get('/mixed', { appId })
  @withAuth(
    [
      apiKey,
      bearer,
    ],
    link,
  )
  @doc
  async mixed(req: Request) {
    return reply(req);
  }

  @get('/optional', { appId })
  @withAuth(optionalBearer, optionalApiKey)
  @doc
  async optional(req: Request) {
    return reply(req);
  }

  @get('/key-and-maybe-user', { appId })
  @withAuth([
    apiKey,
    optionalBearer,
  ])
  @doc
  async keyAndMaybeUser(req: Request) {
    return reply(req);
  }

  @post('/form', { appId })
  @withAuth(bearer, bodyToken)
  @doc
  async form(req: Request) {
    return reply(req);
  }
}

let app: AladoServer;
let port: number;

before(async () => {
  app = initializeApplication({ serverOptions: baseOptions(appId), controllers: [AlternativesController] });
  port = await listen(app);
});

after(() => close(app));

beforeEach(() => {
  for (const name in calls) {
    delete calls[name];
  }
});

const call = (path: string, headers: Record<string, string> = {}) => send(port, { path, headers });

describe('@withAuth(a, b): any one alternative is enough', () => {
  it('lets in either credential, each written to its own outputProperty', async () => {
    assert.deepEqual((await call('/any', { authorization: 'Bearer alice' })).json(), { user: { id: 1 } });
    assert.deepEqual((await call('/any', { 'x-api-key': 'key-1' })).json(), { client: { client: 'ci' } });
  });

  it('stops at the first alternative that passes: later handlers do not run', async () => {
    const r = await call('/any', { authorization: 'Bearer alice', 'x-api-key': 'key-1' });
    assert.deepEqual(r.json(), { user: { id: 1 } });
    assert.deepEqual(calls, { bearer: 1 });
  });

  it('tries the next alternative after a refused or throwing one', async () => {
    assert.deepEqual((await call('/any', { authorization: 'Bearer eve', 'x-api-key': 'key-1' })).json(), {
      client: { client: 'ci' },
    });
    assert.deepEqual((await call('/any', { authorization: 'explode', 'x-api-key': 'key-1' })).json(), {
      client: { client: 'ci' },
    });
  });

  it('answers with the error of the first credential sent and refused, else of the first alternative', async () => {
    const nothing = await call('/any');
    assert.equal(nothing.status, 401);
    assert.deepEqual(nothing.json(), { message: 'Bad token' });
    assert.deepEqual((await call('/any', { 'x-api-key': 'wrong' })).json(), { message: 'Bad API key' });
    assert.deepEqual((await call('/any', { authorization: 'Bearer eve', 'x-api-key': 'wrong' })).json(), {
      message: 'Bad token',
    });
  });

  it('reads the body before authentication when one alternative takes its credential from it', async () => {
    const form = await sendJson(port, 'POST', '/form', { token: 'form-1' });
    assert.equal(form.status, 200);
    assert.deepEqual(form.json(), { form: { form: true } });
    delete calls.bodyToken;
    const refused = await sendJson(port, 'POST', '/form', { token: { $ne: null } });
    assert.equal(refused.status, 401);
    // an object is not a token: refused before the handler sees it
    assert.equal(calls.bodyToken, undefined);
  });
});

describe('@withAuth([a, b]): every strategy of a group must pass', () => {
  for (const path of [
    '/both',
    '/both-helper',
  ]) {
    it(`${path}: needs both credentials and writes both outputs`, async () => {
      assert.deepEqual((await call(path, { 'x-api-key': 'key-1', authorization: 'Bearer alice' })).json(), {
        client: { client: 'ci' },
        user: { id: 1 },
      });
      const keyOnly = await call(path, { 'x-api-key': 'key-1' });
      assert.equal(keyOnly.status, 401);
      assert.deepEqual(keyOnly.json(), { message: 'Bad token' });
    });

    it(`${path}: stops at the first strategy that refuses`, async () => {
      const r = await call(path, { 'x-api-key': 'wrong', authorization: 'Bearer alice' });
      assert.deepEqual(r.json(), { message: 'Bad API key' });
      assert.deepEqual(calls, { apiKey: 1 });
    });
  }

  it('lets an optional member enrich the group without ever failing it', async () => {
    assert.deepEqual((await call('/key-and-maybe-user', { 'x-api-key': 'key-1' })).json(), {
      client: { client: 'ci' },
      user: null,
    });
    assert.deepEqual(
      (await call('/key-and-maybe-user', { 'x-api-key': 'key-1', authorization: 'Bearer alice' })).json(),
      { client: { client: 'ci' }, user: { id: 1 } },
    );
    assert.equal((await call('/key-and-maybe-user', { 'x-api-key': 'key-1', authorization: 'explode' })).status, 200);
    assert.equal((await call('/key-and-maybe-user', { authorization: 'Bearer alice' })).status, 401);
  });
});

describe('@withAuth([a, b], c): groups and alternatives together', () => {
  it('passes with the whole group or with the other alternative', async () => {
    assert.deepEqual((await call('/mixed', { 'x-api-key': 'key-1', authorization: 'Bearer alice' })).json(), {
      client: { client: 'ci' },
      user: { id: 1 },
    });
    assert.deepEqual((await call('/mixed?token=share-1')).json(), { link: { shared: true } });
  });

  it('leaves nothing behind from a group that failed half-way', async () => {
    // the API key passes, the bearer token does not: the group fails, the link lets the request in
    const r = await call('/mixed?token=share-1', { 'x-api-key': 'key-1', authorization: 'Bearer eve' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json(), { link: { shared: true } });
  });

  it('answers with the error of the first refused credential', async () => {
    const r = await call('/mixed?token=wrong');
    assert.equal(r.status, 403);
    assert.deepEqual(r.json(), { message: 'Bad link' });
    // no credential at all: the first alternative's first refusal
    assert.deepEqual((await call('/mixed')).json(), { message: 'Bad API key' });
  });
});

describe('optional alternatives', () => {
  it('let a request without credentials through, and still authenticate one with them', async () => {
    const anonymous = await call('/optional');
    assert.equal(anonymous.status, 200);
    assert.deepEqual((await call('/optional', { authorization: 'Bearer alice' })).json(), { user: { id: 1 } });
  });

  it('try the next alternative when an earlier optional one authenticated nobody', async () => {
    // no bearer token: the API key alternative authenticates the request
    assert.deepEqual((await call('/optional', { 'x-api-key': 'key-1' })).json(), { client: { client: 'ci' } });
    // a refused bearer token does not stop the API key either
    assert.deepEqual((await call('/optional', { authorization: 'Bearer eve', 'x-api-key': 'key-1' })).json(), {
      client: { client: 'ci' },
    });
  });

  it('fall back to the first alternative when none authenticates', async () => {
    const r = await call('/optional', { authorization: 'Bearer eve', 'x-api-key': 'wrong' });
    assert.equal(r.status, 200);
    // the first alternative's result, as with a single optional strategy
    assert.deepEqual(r.json(), { user: null });
  });

  it('stop at the first alternative that authenticates', async () => {
    assert.deepEqual((await call('/optional', { authorization: 'Bearer alice', 'x-api-key': 'key-1' })).json(), {
      user: { id: 1 },
    });
    assert.deepEqual(calls, { bearer: 1 });
  });
});

describe('Context.auth with alternatives, without decorators', () => {
  const route = (auth: unknown): any => ({
    title: 't',
    auth,
    options: { allowUnknownFields: false, openApiDoc: { operationId: `op-${Math.random()}`, description: 'd' } },
    request: {},
    response: { statusCode: 200, body: {} },
  });
  const handler = async (req: Request) => reply(req);

  it('works on routes registered with app.get', async () => {
    const plain = new AladoServer(baseOptions('auth-alternatives-plain'));
    plain.get(
      '/x',
      route([
        [
          apiKey,
          bearer,
        ],
        link,
      ]),
      handler,
    );
    const plainPort = await listen(plain);
    try {
      const r = await send(plainPort, { path: '/x', headers: { 'X-API-KEY': 'key-1', authorization: 'Bearer alice' } });
      assert.deepEqual(r.json(), { client: { client: 'ci' }, user: { id: 1 } });
      assert.equal((await send(plainPort, { path: '/x' })).status, 401);
    } finally {
      await close(plain);
    }
  });

  it('documents alternatives and groups as OpenAPI security requirements', async () => {
    const documented = new AladoServer(
      baseOptions('auth-alternatives-doc', {
        openApiDoc: { enable: true, route: '/docs', info: { title: 't', version: '1' } },
      }),
    );
    documented.get('/single', route(bearer), handler);
    documented.get(
      '/any',
      route([
        bearer,
        apiKey,
      ]),
      handler,
    );
    documented.get(
      '/mixed',
      route([
        [
          apiKey,
          bearer,
        ],
        link,
      ]),
      handler,
    );
    documented.get(
      '/optional',
      route([
        optionalBearer,
        optionalApiKey,
      ]),
      handler,
    );
    documented.get(
      '/key-and-maybe-user',
      route([
        [
          apiKey,
          optionalBearer,
        ],
      ]),
      handler,
    );
    documented.post(
      '/body-or-header',
      route([
        bodyToken,
        bearer,
      ]),
      handler,
    );
    const docPort = await listen(documented);
    try {
      const { paths, components } = (await send(docPort, { path: '/docs/swagger.json' })).json();
      assert.deepEqual(paths['/single'].get.security, [{ headersAuthorization: [] }]);
      assert.deepEqual(paths['/any'].get.security, [
        { headersAuthorization: [] },
        { 'headersX-Api-Key': [] },
      ]);
      assert.deepEqual(paths['/mixed'].get.security, [
        { 'headersX-Api-Key': [], headersAuthorization: [] },
        { queryToken: [] },
      ]);
      assert.deepEqual(paths['/optional'].get.security, [
        { headersAuthorization: [] },
        { 'headersX-Api-Key': [] },
        {},
      ]);
      // an optional member is not a requirement of its group
      assert.deepEqual(paths['/key-and-maybe-user'].get.security, [{ 'headersX-Api-Key': [] }]);
      // a body credential has no security scheme: only the header alternative is listed
      assert.deepEqual(paths['/body-or-header'].post.security, [{ headersAuthorization: [] }]);
      assert.deepEqual(components.securitySchemes['headersX-Api-Key'], {
        type: 'apiKey',
        in: 'header',
        name: 'x-api-key',
      });
      assert.deepEqual(components.securitySchemes.queryToken, { type: 'apiKey', in: 'query', name: 'token' });
    } finally {
      await close(documented);
    }
  });

  it('refuses a GET route when any alternative reads its credential from the body', () => {
    const server = new AladoServer(baseOptions('auth-alternatives-get-body'));
    assert.throws(
      () =>
        server.get(
          '/x',
          route([
            bearer,
            [
              apiKey,
              bodyToken,
            ],
          ]),
          handler,
        ),
      /reads the request body/,
    );
  });

  it('refuses an auth list that cannot mean what it says', () => {
    const server = new AladoServer(baseOptions('auth-alternatives-bad'));
    const cases: Array<
      [
        unknown,
        RegExp,
      ]
    > = [
      [
        [],
        /Context\.auth should list at least one RequestAuthentication/,
      ],
      [
        [[]],
        /Context\.auth\[0\] should list at least one RequestAuthentication/,
      ],
      [
        [
          [
            bearer,
            [apiKey],
          ],
        ],
        /Context\.auth\[0\] holds a group inside a group/,
      ],
      [
        [
          [
            bearer,
            bearer,
          ],
        ],
        /Context\.auth\[0\] lists the same RequestAuthentication twice/,
      ],
      [
        [
          bearer,
          optionalApiKey,
        ],
        /mixes alternatives that need credentials with ones that need none/,
      ],
      [
        [
          bearer,
          { ...apiKey, outputProperty: 'user' },
        ],
        /outputProperty should point to the auth/,
      ],
    ];
    for (const [
      auth,
      message,
    ] of cases) {
      assert.throws(() => server.get('/bad', route(auth), handler), message, JSON.stringify(auth));
    }
  });

  it('refuses @withAuth() without any strategy', () => {
    assert.throws(() => {
      class Empty {
        @get('/empty', { appId: 'auth-alternatives-empty' })
        @withAuth()
        @doc
        async empty(req: Request) {
          return reply(req);
        }
      }
      initializeApplication({ serverOptions: baseOptions('auth-alternatives-empty'), controllers: [Empty] });
    }, /Context\.auth should list at least one RequestAuthentication/);
  });
});
