import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer } from '../../src';
import { baseOptions, close, listen, send } from '../helpers/http';

const json = { 'Content-Type': 'application/json' };
const route = (body: unknown): any => ({
  title: 't',
  options: { allowUnknownFields: false },
  request: {},
  response: { statusCode: 200, headers: json, body },
});
const ok = async () => ({ statusCode: 200, headers: json, body: {} });

describe('OpenAPI schemas from response examples', () => {
  let app: AladoServer;
  after(() => close(app));

  it('describe arrays, nulls, dates and fields called "type" as what they are', async () => {
    app = new AladoServer(
      baseOptions('openapi-examples', {
        openApiDoc: { enable: true, route: '/docs', info: { title: 't', version: '1' } },
        cors: { enable: true, allowedOrigin: ['https://tools.example.com'] },
      }),
    );
    app.get(
      '/a',
      route({
        user: { type: 'admin', name: 'x' },
        tags: [
          'a',
          'b',
        ],
        rows: [{ id: 1 }],
        empty: [],
        when: null,
        at: new Date(0),
        byHand: { type: 'string', format: 'uuid' },
        count: 1,
      }),
      ok,
    );
    const port = await listen(app);
    const get = (origin?: string) =>
      send(port, { path: '/docs/swagger.json', headers: origin ? { Origin: origin } : {} });
    const first = await get('https://tools.example.com');
    assert.deepEqual(first.json().components.schemas.GetA200.properties, {
      user: { type: 'object', properties: { type: { type: 'string' }, name: { type: 'string' } } },
      tags: { type: 'array', items: { type: 'string' } },
      rows: { type: 'array', items: { type: 'object', properties: { id: { type: 'number' } } } },
      empty: { type: 'array', items: {} },
      when: { nullable: true },
      at: { type: 'string', format: 'date-time' },
      byHand: { type: 'string', format: 'uuid' },
      count: { type: 'number' },
    });

    // the docs carry the CORS headers of the API
    assert.equal(first.headers['access-control-allow-origin'], 'https://tools.example.com');
    assert.equal(first.headers.vary, 'Origin');
    assert.equal((await get('https://other.example.com')).headers['access-control-allow-origin'], undefined);
    const page = await send(port, { path: '/docs', headers: { Origin: 'https://tools.example.com' } });
    assert.equal(page.headers['access-control-allow-origin'], 'https://tools.example.com');

    // the document is serialised once, and again after a route is added
    assert.equal((await get()).text, first.text);
    app.get('/b', route({ late: true }), ok);
    assert.ok((await get()).json().paths['/b'], 'a route registered later is in the document');
  });
});
