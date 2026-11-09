import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer, defineRequest, documentProperty, initializeApplication, post } from '../../src';
import { baseOptions } from '../helpers/http';

const response = { statusCode: 204 };

describe('a request field without a validator', () => {
  it('is refused at registration with the field it concerns', () => {
    const app = new AladoServer(baseOptions('missing-validator'));
    const context = (body: any) =>
      ({ title: 't', options: { allowUnknownFields: false }, request: { body }, response }) as any;
    assert.throws(
      () => app.post('/a', context({ reason: { openApiDoc: { schema: { type: 'string' } } } }), async () => response),
      (e: any) => !(e instanceof TypeError) && /Request field body\.reason has no validator/.test(e.message),
    );
    assert.throws(
      () => app.post('/b', context({ reason: undefined }), async () => response),
      (e: any) =>
        !(e instanceof TypeError) && /Request field body\.reason: the definition should be an object/.test(e.message),
    );
    assert.throws(
      () => app.post('/c', context({ reason: { validation: { required: true } } }), async () => response),
      /Request field body\.reason: PropertyDefinition\.validation\.handler is required property/,
    );
  });

  it('is refused for a DTO property that is only documented', () => {
    class OnlyDocumented {
      @documentProperty({ schema: { type: 'string' } })
      reason: string = '';
    }
    class Controller {
      @post('/documented', { appId: 'missing-validator-dto' })
      @defineRequest({ body: OnlyDocumented })
      async create() {
        return response;
      }
    }
    assert.throws(
      () => initializeApplication({ serverOptions: baseOptions('missing-validator-dto'), controllers: [Controller] }),
      /Request field body\.reason has no validator/,
    );
  });
});
