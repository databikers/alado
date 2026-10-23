import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  AladoServer,
  Request,
  defineRequest,
  defineResponse,
  get,
  initializeApplication,
  patch,
  post,
  transformProperty,
  validate,
  validateProperty,
} from '../../src';
import { baseOptions, close, listen, multipart, send, sendJson } from '../helpers/http';

const appId = 'validation';
const json = { 'Content-Type': 'application/json' };
const doc = defineResponse({ statusCode: 200, headers: json, body: { ok: true } });
const LIMIT = 1024;

class SignupBodyDto {
  @validateProperty({
    required: true,
    handler: validate.string().email().required().build(),
    error: { statusCode: 400, message: 'Invalid email' },
  })
  @transformProperty((v: string) => v.toLowerCase())
  email: string = 'user@example.com';

  @validateProperty({
    handler: validate.number().integer().min(18).build(),
    error: { statusCode: 422, message: 'Too young' },
  })
  age: number = 30;
}

class SearchQueryDto {
  @validateProperty({
    required: true,
    handler: validate.string().min(2).required().build(),
    error: { statusCode: 400, message: 'q is required' },
  })
  q: string = 'abc';

  @validateProperty({
    handler: (v: string) => /^\d+$/.test(v),
    error: { statusCode: 400, message: 'limit must be numeric' },
  })
  @transformProperty((v: string) => Number(v))
  limit: number = 10;
}

class TenantHeaderDto {
  @validateProperty({
    required: true,
    handler: validate.string().uuid().required().build(),
    error: { statusCode: 400, message: 'x-tenant-id must be a uuid' },
  })
  'x-tenant-id': string = '123e4567-e89b-12d3-a456-426614174000';
}

class IdPathDto {
  @validateProperty({
    required: true,
    handler: validate.string().objectId().required().build(),
    error: { statusCode: 404, message: 'Not Found' },
  })
  id: string = '507f1f77bcf86cd799439011';
}

class ContextAwareDto {
  @validateProperty({
    required: true,
    // `this` is the Request: the body value must match the header
    handler: function (this: Request, v: string) {
      return v === this.headers?.['x-expected'];
    },
    error: { statusCode: 409, message: 'Mismatch' },
  })
  value: string = 'x';
}

class ThrowingDto {
  @validateProperty({
    required: true,
    handler: () => {
      throw new Error('validator exploded');
    },
    error: { statusCode: 400, message: 'Bad' },
  })
  value: string = 'x';
}

class FormDto {
  @validateProperty({
    required: true,
    handler: (v: unknown) => typeof v === 'string',
    error: { statusCode: 400, message: 'name' },
  })
  name: string = 'x';

  @validateProperty({ handler: (v: unknown) => typeof v === 'string', error: { statusCode: 400, message: 'city' } })
  city: string = 'x';
}

class PaymentXmlDto {
  @validateProperty({
    required: true,
    handler: validate
      .object()
      .shape({
        amount: validate
          .string()
          .regex(/^\d+\.\d{2}$/)
          .required()
          .build(),
      })
      .build(),
    error: { statusCode: 400, message: 'Invalid payment' },
  })
  payment: any = { amount: '1.00' };
}

class ValidationController {
  @post('/signup', { appId })
  @defineRequest({ body: SignupBodyDto })
  @doc
  async signup(req: Request) {
    return { statusCode: 201, headers: json, body: req.body };
  }

  @get('/search', { appId })
  @defineRequest({ query: SearchQueryDto })
  @doc
  async search(req: Request) {
    return { statusCode: 200, headers: json, body: req.query };
  }

  @get('/tenant', { appId })
  @defineRequest({ headers: TenantHeaderDto })
  @doc
  async tenant(req: Request) {
    return {
      statusCode: 200,
      headers: json,
      body: { tenant: req.headers?.['x-tenant-id'], other: req.headers?.['x-other'] },
    };
  }

  @patch('/records/:id', { appId })
  @defineRequest({ path: IdPathDto })
  @doc
  async record(req: Request) {
    return { statusCode: 200, headers: json, body: req.path };
  }

  @post('/context', { appId })
  @defineRequest({ body: ContextAwareDto })
  @doc
  async context() {
    return { statusCode: 200, headers: json, body: { ok: true } };
  }

  @post('/throwing', { appId })
  @defineRequest({ body: ThrowingDto })
  @doc
  async throwing() {
    return { statusCode: 200, headers: json, body: { ok: true } };
  }

  @post('/form', { appId })
  @defineRequest({ body: FormDto })
  @doc
  async form(req: Request) {
    return { statusCode: 200, headers: json, body: req.body };
  }

  @post('/raw', { appId })
  @doc
  async raw(req: Request) {
    return { statusCode: 200, headers: json, body: { rawBody: req.rawBody, body: req.body } };
  }

  @post('/payment', { appId })
  @defineRequest({ body: PaymentXmlDto })
  @doc
  async payment(req: Request) {
    return { statusCode: 200, headers: json, body: req.body };
  }
}

let app: AladoServer;
let port: number;

before(async () => {
  app = initializeApplication({
    serverOptions: baseOptions(appId, { maxBodySizeBytes: LIMIT }),
    controllers: [ValidationController],
  });
  port = await listen(app);
});

after(() => close(app));

describe('body validation', () => {
  it('accepts a valid body and applies transforms', async () => {
    const r = await sendJson(port, 'POST', '/signup', { email: 'User@Example.COM', age: 30 });
    assert.equal(r.status, 201);
    assert.deepEqual(r.json(), { email: 'user@example.com', age: 30 });
  });

  it('returns the configured error for a missing required field', async () => {
    const r = await sendJson(port, 'POST', '/signup', { age: 30 });
    assert.equal(r.status, 400);
    assert.deepEqual(r.json(), { message: 'Invalid email' });
  });

  it('returns the configured status code per field', async () => {
    const r = await sendJson(port, 'POST', '/signup', { email: 'a@b.co', age: 12 });
    assert.equal(r.status, 422);
    assert.deepEqual(r.json(), { message: 'Too young' });
  });

  it('skips validation for absent optional fields', async () => {
    const r = await sendJson(port, 'POST', '/signup', { email: 'a@b.co' });
    assert.equal(r.status, 201);
  });

  it('strips fields that are not declared on the DTO', async () => {
    const r = await sendJson(port, 'POST', '/signup', { email: 'a@b.co', isAdmin: true, role: 'owner' });
    assert.equal(r.status, 201);
    assert.deepEqual(r.json(), { email: 'a@b.co' });
  });

  it('drops __proto__ / constructor keys from JSON bodies', async () => {
    const r = await send(port, {
      method: 'POST',
      path: '/raw',
      headers: { 'Content-Type': 'application/json' },
      body: '{"a":1,"__proto__":{"polluted":true},"constructor":{"prototype":{"x":1}}}',
    });
    assert.equal(r.status, 200);
    assert.equal(({} as any).polluted, undefined);
  });

  it('binds `this` to the request inside validation handlers', async () => {
    const ok = await sendJson(port, 'POST', '/context', { value: 'abc' }, { 'x-expected': 'abc' });
    assert.equal(ok.status, 200);
    const bad = await sendJson(port, 'POST', '/context', { value: 'abc' }, { 'x-expected': 'zzz' });
    assert.equal(bad.status, 409);
  });

  it('maps a throwing validator to the field error status', async () => {
    const r = await sendJson(port, 'POST', '/throwing', { value: 'x' });
    assert.equal(r.status, 400);
  });

  it('rejects malformed JSON with 400', async () => {
    const r = await send(port, {
      method: 'POST',
      path: '/signup',
      headers: { 'Content-Type': 'application/json' },
      body: '{"email":',
    });
    assert.equal(r.status, 400);
    assert.deepEqual(r.json(), { message: 'Invalid JSON body' });
  });

  it('rejects bodies above maxBodySizeBytes with 413', async () => {
    const r = await send(port, {
      method: 'POST',
      path: '/raw',
      headers: { 'Content-Type': 'text/plain' },
      body: 'x'.repeat(LIMIT * 4),
    }).catch((e) => e);
    // the server may reset the socket after answering; either outcome must not be 2xx
    if (r instanceof Error) {
      assert.match(r.message, /ECONNRESET|socket hang up|EPIPE/);
    } else {
      assert.equal(r.status, 413);
    }
  });

  it('exposes the raw body and passes unknown content types through as text', async () => {
    const r = await send(port, {
      method: 'POST',
      path: '/raw',
      headers: { 'Content-Type': 'text/plain' },
      body: 'hello',
    });
    assert.equal(r.status, 200);
    assert.equal(r.json().rawBody, 'hello');
  });

  it(
    'enforces maxBodySizeBytes for multipart bodies too',
    { todo: 'SECURITY: the multipart branch of bodyParser never checks the limit (unbounded memory)' },
    async () => {
      const { body, contentType } = multipart([{ name: 'name', value: 'x'.repeat(LIMIT * 4) }]);
      const r = await send(port, {
        method: 'POST',
        path: '/form',
        headers: { 'Content-Type': contentType },
        body,
      }).catch((e) => e);
      assert.ok(r instanceof Error || r.status === 413, `got ${r.status}`);
    },
  );
});

describe('form bodies', () => {
  it('parses multipart text fields', async () => {
    const { body, contentType } = multipart([
      { name: 'name', value: 'Pablo' },
      { name: 'city', value: 'Bangkok' },
    ]);
    const r = await send(port, { method: 'POST', path: '/form', headers: { 'Content-Type': contentType }, body });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json(), { name: 'Pablo', city: 'Bangkok' });
  });

  it('parses simple urlencoded bodies', async () => {
    const r = await send(port, {
      method: 'POST',
      path: '/form',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'name=Pablo&city=Bangkok',
    });
    assert.deepEqual(r.json(), { name: 'Pablo', city: 'Bangkok' });
  });

  it(
    'decodes urlencoded values',
    { todo: 'BUG: x-www-form-urlencoded values are never decoded ("New%20York", "+" kept as-is)' },
    async () => {
      const r = await send(port, {
        method: 'POST',
        path: '/form',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'name=Pablo+L&city=New%20York',
      });
      assert.deepEqual(r.json(), { name: 'Pablo L', city: 'New York' });
    },
  );
});

describe('XML bodies', () => {
  it('validates an XML body through the same DTO', async () => {
    const r = await send(port, {
      method: 'POST',
      path: '/payment',
      headers: { 'Content-Type': 'application/xml' },
      body: '<?xml version="1.0"?><payment><amount>10000.00</amount></payment>',
    });
    assert.equal(r.status, 200);
    assert.equal(r.json().payment.amount, '10000.00');
  });

  it('accepts text/xml', async () => {
    const r = await send(port, {
      method: 'POST',
      path: '/payment',
      headers: { 'Content-Type': 'text/xml' },
      body: '<payment><amount>1.50</amount></payment>',
    });
    assert.equal(r.status, 200);
  });

  it('returns the DTO error for an XML body that fails validation', async () => {
    const r = await send(port, {
      method: 'POST',
      path: '/payment',
      headers: { 'Content-Type': 'application/xml' },
      body: '<payment><amount>1.5</amount></payment>',
    });
    assert.equal(r.status, 400);
    assert.deepEqual(r.json(), { message: 'Invalid payment' });
  });

  it('rejects malformed XML with 400', async () => {
    const r = await send(port, {
      method: 'POST',
      path: '/payment',
      headers: { 'Content-Type': 'application/xml' },
      body: '<payment><amount>1.50</oops></payment>',
    });
    assert.equal(r.status, 400);
    assert.match(r.json().message, /Invalid XML body/);
  });

  it(
    'accepts application/xml with a charset parameter',
    {
      todo: 'BUG: XML is matched with includes(contentType), so "application/xml; charset=utf-8" falls through to raw text',
    },
    async () => {
      const r = await send(port, {
        method: 'POST',
        path: '/payment',
        headers: { 'Content-Type': 'application/xml; charset=utf-8' },
        body: '<payment><amount>1.50</amount></payment>',
      });
      assert.equal(r.status, 200);
    },
  );
});

describe('query validation', () => {
  it('validates and transforms query params', async () => {
    const r = await send(port, { path: '/search?q=node&limit=20' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json(), { q: 'node', limit: 20 });
  });

  it('rejects a missing required query param', async () => {
    const r = await send(port, { path: '/search?limit=20' });
    assert.equal(r.status, 400);
    assert.deepEqual(r.json(), { message: 'q is required' });
  });

  it('strips undeclared query params', async () => {
    const r = await send(port, { path: '/search?q=node&debug=1' });
    assert.deepEqual(r.json(), { q: 'node' });
  });

  it(
    'answers 400, not 500, for a malformed percent-encoding',
    { todo: 'BUG: URIError from decodeURIComponent bubbles up as 500' },
    async () => {
      const r = await send(port, { path: '/search?q=%E0%A4%A' });
      assert.equal(r.status, 400);
    },
  );
});

describe('header and path validation', () => {
  it('validates headers', async () => {
    const ok = await send(port, {
      path: '/tenant',
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
    });
    assert.equal(ok.status, 200);
    const bad = await send(port, { path: '/tenant', headers: { 'x-tenant-id': 'nope' } });
    assert.equal(bad.status, 400);
  });

  it('does not strip undeclared headers', async () => {
    const r = await send(port, {
      path: '/tenant',
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000', 'x-other': 'kept' },
    });
    assert.equal(r.json().other, 'kept');
  });

  it('validates path params', async () => {
    const ok = await sendJson(port, 'PATCH', '/records/507f1f77bcf86cd799439011', {});
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json(), { id: '507f1f77bcf86cd799439011' });
    const bad = await sendJson(port, 'PATCH', '/records/123', {});
    assert.equal(bad.status, 404);
  });
});
