import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer, AladoServerOptions, initializeApplication } from '../../src';
import { close, listen, send, silentLogger } from '../helpers/http';

// no `as any`: these must type-check without cors and openApiDoc
const minimal: AladoServerOptions = { port: 0, host: '127.0.0.1', logger: silentLogger, appId: 'minimal-options' };

describe('server options without cors and openApiDoc', () => {
  it('start with CORS and the docs disabled', async () => {
    const app: AladoServer = initializeApplication({ serverOptions: minimal, controllers: [] });
    const port = await listen(app);
    try {
      const r = await send(port, { path: '/swagger.json', headers: { Origin: 'https://app.example.com' } });
      assert.equal(r.status, 404);
      assert.equal(r.headers['access-control-allow-origin'], undefined);
    } finally {
      await close(app);
    }
  });

  it('work for a server created directly', () => {
    assert.doesNotThrow(() => new AladoServer({ port: 0, host: '127.0.0.1', logger: silentLogger }));
  });
});
