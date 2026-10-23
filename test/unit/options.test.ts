import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateAladoOptions, distinguishControllerBuildStrategy, validateContext } from '../../src/helpers';

const valid = () =>
  ({
    port: 3000,
    cors: { enable: false },
    openApiDoc: { enable: false },
  }) as any;

describe('validateAladoOptions', () => {
  it('accepts a minimal config', () => {
    assert.doesNotThrow(() => validateAladoOptions(valid()));
  });

  it('accepts port 0 (ephemeral)', () => {
    assert.doesNotThrow(() => validateAladoOptions({ ...valid(), port: 0 }));
  });

  for (const port of [
    '3000',
    -1,
    65536,
    1.5,
  ]) {
    it(`rejects port ${JSON.stringify(port)}`, () => {
      assert.throws(() => validateAladoOptions({ ...valid(), port }), /port/);
    });
  }

  it('requires cors.enable to be boolean', () => {
    assert.throws(() => validateAladoOptions({ ...valid(), cors: {} }), /cors\.enable/);
  });

  it('validates cors fields only when enabled', () => {
    assert.doesNotThrow(() => validateAladoOptions({ ...valid(), cors: { enable: false, allowedOrigin: 1 } }));
    assert.throws(
      () => validateAladoOptions({ ...valid(), cors: { enable: true, allowedOrigin: 1 } }),
      /allowedOrigin/,
    );
  });

  it('accepts allowedOrigin as a list of non-empty strings', () => {
    assert.doesNotThrow(() =>
      validateAladoOptions({
        ...valid(),
        cors: {
          enable: true,
          allowedOrigin: [
            'https://a.com',
            'https://b.com',
          ],
        },
      }),
    );
    assert.throws(() =>
      validateAladoOptions({
        ...valid(),
        cors: {
          enable: true,
          allowedOrigin: [
            'ok',
            '',
          ],
        },
      }),
    );
  });

  it('rejects non-array allowedHeaders / exposeHeaders', () => {
    assert.throws(() => validateAladoOptions({ ...valid(), cors: { enable: true, allowedHeaders: 'x' } }));
    assert.throws(() => validateAladoOptions({ ...valid(), cors: { enable: true, exposeHeaders: [1] } }));
  });

  it('rejects negative cors.maxAge', () => {
    assert.throws(() => validateAladoOptions({ ...valid(), cors: { enable: true, maxAge: -1 } }), /maxAge/);
  });

  it('requires route and info when openApiDoc is enabled', () => {
    assert.throws(() => validateAladoOptions({ ...valid(), openApiDoc: { enable: true, info: {} } }), /route/);
    assert.throws(() => validateAladoOptions({ ...valid(), openApiDoc: { enable: true, route: '/docs' } }), /info/);
    assert.throws(() =>
      validateAladoOptions({ ...valid(), openApiDoc: { enable: true, route: '/docs', info: { title: 1 } } }),
    );
  });

  it('validates logger, verbose, maxBodySizeBytes', () => {
    assert.throws(() => validateAladoOptions({ ...valid(), logger: {} }), /logger\.log/);
    assert.throws(() => validateAladoOptions({ ...valid(), verbose: 'yes' }), /verbose/);
    assert.throws(() => validateAladoOptions({ ...valid(), maxBodySizeBytes: -1 }), /maxBodySizeBytes/);
  });
});

describe('distinguishControllerBuildStrategy', () => {
  class A {}
  it('class -> simple', () => {
    assert.equal(distinguishControllerBuildStrategy(A), 'simple');
  });
  it('{ controller, options } -> complex', () => {
    assert.equal(distinguishControllerBuildStrategy({ controller: A, options: [] }), 'complex');
  });
  it('rejects functions, missing options and instances', () => {
    assert.throws(() => distinguishControllerBuildStrategy(function F() {}));
    assert.throws(() => distinguishControllerBuildStrategy({ controller: A }));
    assert.throws(() => distinguishControllerBuildStrategy(new A()));
  });
});

describe('validateContext', () => {
  const ctx = () =>
    ({
      title: 'GET /x',
      options: { allowUnknownFields: false },
      request: {},
      response: { statusCode: 200, body: { ok: true } },
    }) as any;

  it('accepts a minimal context', () => {
    assert.doesNotThrow(() => validateContext(ctx()));
  });

  it('requires a string title', () => {
    assert.throws(() => validateContext({ ...ctx(), title: '' }), /title/);
    assert.throws(() => validateContext({ ...ctx(), title: 1 }), /title/);
  });

  it('requires a body unless the response is 204', () => {
    assert.throws(() => validateContext({ ...ctx(), response: { statusCode: 200 } }), /204/);
    assert.doesNotThrow(() => validateContext({ ...ctx(), response: { statusCode: 204 } }));
  });

  it('rejects an out-of-range response status', () => {
    assert.throws(() => validateContext({ ...ctx(), response: { statusCode: 99, body: {} } }));
    assert.throws(() => validateContext({ ...ctx(), response: { statusCode: 600, body: {} } }));
  });

  it('restricts auth.inputProperty to headers|path|query|body', () => {
    const auth = {
      inputProperty: 'cookies.sid',
      outputProperty: 'auth.user',
      handler: () => true,
      required: true,
      error: { statusCode: 401, message: 'Unauthorized' },
    };
    assert.throws(() => validateContext({ ...ctx(), auth }), /inputProperty/);
    assert.doesNotThrow(() => validateContext({ ...ctx(), auth: { ...auth, inputProperty: 'headers.authorization' } }));
  });

  it('restricts auth.outputProperty to auth.*', () => {
    const auth = {
      inputProperty: 'headers.authorization',
      outputProperty: 'body.user',
      handler: () => true,
      required: true,
      error: { statusCode: 401, message: 'Unauthorized' },
    };
    assert.throws(() => validateContext({ ...ctx(), auth }), /outputProperty/);
  });

  it('requires a validation handler and error on every property definition', () => {
    const bad = { ...ctx(), request: { body: { name: { validation: { required: true } } } } };
    assert.throws(() => validateContext(bad), /handler/);
    const noError = { ...ctx(), request: { body: { name: { validation: { handler: () => true } } } } };
    assert.throws(() => validateContext(noError), /error/);
  });

  it('rejects unknown OpenAPI schema keys', () => {
    const c = {
      ...ctx(),
      request: {
        body: {
          name: {
            validation: { handler: () => true, error: { statusCode: 400, message: 'bad' } },
            openApiDoc: { schema: { type: 'string', example: 'x' } },
          },
        },
      },
    };
    assert.throws(() => validateContext(c), /schema/);
  });

  it('requires mimetypes, positive maxSize and all three errors on file definitions', () => {
    const err = { statusCode: 400, message: 'bad' };
    const file = { mimetypes: ['image/png'], maxSize: 10, mimetypeError: err, maxSizeError: err, requiredError: err };
    assert.doesNotThrow(() => validateContext({ ...ctx(), request: { files: { avatar: file } } }));
    assert.throws(() => validateContext({ ...ctx(), request: { files: { avatar: { ...file, maxSize: 0 } } } }));
    assert.throws(
      () => validateContext({ ...ctx(), request: { files: { avatar: { ...file, mimetypes: 'image/png' as any } } } }),
      /mimetypes/,
    );
    assert.throws(() =>
      validateContext({ ...ctx(), request: { files: { avatar: { ...file, requiredError: undefined } } } }),
    );
  });
});
