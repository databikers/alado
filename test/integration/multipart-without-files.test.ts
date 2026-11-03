import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  AladoServer,
  Request,
  defineRequest,
  defineResponse,
  initializeApplication,
  post,
  validateProperty,
} from '../../src';
import { baseOptions, close, listen, multipart, send } from '../helpers/http';

const appId = 'multipart-without-files';
const json = { 'Content-Type': 'application/json' };

class NameBodyDto {
  @validateProperty({
    required: true,
    handler: (v: unknown) => typeof v === 'string',
    error: { statusCode: 400, message: 'name is required' },
  })
  name: string = 'x';
}

class FormController {
  @post('/form', { appId })
  @defineRequest({ body: NameBodyDto })
  @defineResponse({ statusCode: 200, headers: json, body: {} })
  async form(req: Request) {
    return { statusCode: 200, headers: json, body: { body: req.body, files: Object.keys(req.files || {}) } };
  }
}

let app: AladoServer;
let port: number;

before(async () => {
  app = initializeApplication({ serverOptions: baseOptions(appId), controllers: [FormController] });
  app.post(
    '/open',
    {
      title: 'open',
      options: { allowUnknownFields: true, isHidden: true },
      request: {},
      response: { statusCode: 200, headers: json, body: {} },
    },
    async (req: Request) => ({ statusCode: 200, headers: json, body: { files: Object.keys(req.files || {}) } }),
  );
  port = await listen(app);
});

after(() => close(app));

const parts = [
  { name: 'name', value: 'bob' },
  { name: 'f1', filename: 'a.txt', contentType: 'text/plain', value: 'one' },
  { name: 'f2', filename: 'b.txt', contentType: 'text/plain', value: 'two' },
];

describe('multipart on routes without file fields', () => {
  it('parses the text fields and hands the handler no files', async () => {
    const { body, contentType } = multipart(parts);
    const r = await send(port, { method: 'POST', path: '/form', headers: { 'Content-Type': contentType }, body });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json(), { body: { name: 'bob' }, files: [] });
  });

  it('still passes files to routes that allow unknown fields', async () => {
    const { body, contentType } = multipart(parts);
    const r = await send(port, { method: 'POST', path: '/open', headers: { 'Content-Type': contentType }, body });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json().files.sort(), [
      'f1',
      'f2',
    ]);
  });
});
