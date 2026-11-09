import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { AladoServer } from '../../src';
import { mergeHeaders } from '../../src/request-processor/request-processor';
import { baseOptions, close, listen } from '../helpers/http';

const context = {
  title: 't',
  request: {},
  options: { allowUnknownFields: true },
  response: { statusCode: 200, body: { ok: true } },
} as any;

// raw header lines, so a header sent twice shows up twice
const rawHeaders = (port: number, path: string, headers: Record<string, string> = {}) =>
  new Promise<
    Array<
      [
        string,
        string,
      ]
    >
  >((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path, headers }, (res) => {
        res.resume();
        const pairs: Array<
          [
            string,
            string,
          ]
        > = [];
        for (let i = 0; i < res.rawHeaders.length; i += 2) {
          pairs.push([
            res.rawHeaders[i].toLowerCase(),
            res.rawHeaders[i + 1],
          ]);
        }
        res.on('end', () => resolve(pairs));
      })
      .on('error', reject);
  });
const values = (
  pairs: Array<
    [
      string,
      string,
    ]
  >,
  name: string,
) =>
  pairs
    .filter(([n]) => n === name)
    .map(
      ([
        ,
        v,
      ]) => v,
    );

describe('mergeHeaders', () => {
  it('keeps one spelling per header, later sources winning', () => {
    assert.deepEqual(mergeHeaders({ 'Content-Type': 'a' }, undefined, { 'content-type': 'b', 'X-A': '1' }), {
      'content-type': 'b',
      'X-A': '1',
    });
  });

  it('copies a single source as it is', () => {
    assert.deepEqual(mergeHeaders(undefined, {}, { 'content-type': 'b' }), { 'content-type': 'b' });
  });
});

describe('response headers set by the server, CORS and the handler', () => {
  const app = new AladoServer(
    baseOptions('header-merging', {
      headers: { 'Content-Type': 'application/json', 'X-Powered-By': 'alado' },
      cors: { enable: true, allowedOrigin: ['https://app.example.com'] },
    }),
  );
  let port: number;

  before(async () => {
    app.get('/own', context, async () => ({
      statusCode: 200,
      headers: { 'access-control-allow-origin': '*', 'content-type': 'text/plain', vary: 'Accept' },
      body: 'x',
    }));
    port = await listen(app);
  });

  after(() => close(app));

  it('are sent once each, with the handler value', async () => {
    const pairs = await rawHeaders(port, '/own', { Origin: 'https://app.example.com' });
    assert.deepEqual(values(pairs, 'access-control-allow-origin'), ['*']);
    assert.deepEqual(values(pairs, 'content-type'), ['text/plain']);
    assert.deepEqual(values(pairs, 'x-powered-by'), ['alado']);
  });

  it('still merge Vary tokens into one header', async () => {
    const pairs = await rawHeaders(port, '/own', { Origin: 'https://app.example.com' });
    assert.deepEqual(values(pairs, 'vary'), ['Accept, Origin']);
  });
});
