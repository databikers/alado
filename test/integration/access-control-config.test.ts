import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer } from '../../src';
import { baseOptions } from '../helpers/http';

const rule = { inputProperty: 'headers.x-role', expectedValue: 'admin', statusCode: 403, message: 'Forbidden' };
const register = (accessControl: unknown) =>
  new AladoServer(baseOptions('access-control-config')).get(
    '/x',
    {
      title: 't',
      options: { allowUnknownFields: false },
      request: {},
      accessControl,
      response: { statusCode: 204 },
    } as any,
    async () => ({ statusCode: 204 }),
  );

describe('access-control rules are checked at registration', () => {
  it('accepts a rule with a check, in each of its three forms', () => {
    register([rule]);
    register([{ ...rule, expectedValue: undefined, compareWithProperty: 'auth.user.id' }]);
    register([{ ...rule, expectedValue: undefined, accessControlHandler: async () => true }]);
    register([{ ...rule, inputProperty: 'auth.user.roles[0]', transformInputProperty: String }]);
    register(undefined);
  });

  it('refuses a rule that checks nothing', () => {
    assert.throws(
      () => register([{ inputProperty: 'headers.x-role', statusCode: 403, message: 'Forbidden' }]),
      /accessControl\[0\] checks nothing/,
    );
  });

  it('refuses misspelled properties and paths', () => {
    assert.throws(
      () => register([{ ...rule, expectedValu: 'admin' }]),
      /accessControl\[0\]\.expectedValu is not a rule/,
    );
    assert.throws(
      () => register([{ ...rule, inputProperty: 'header.x-role' }]),
      /inputProperty "header\.x-role" should start/,
    );
    assert.throws(
      () =>
        register([
          rule,
          { ...rule, compareWithProperty: 'pth.id' },
        ]),
      /accessControl\[1\]\.compareWithProperty/,
    );
    assert.throws(() => register([{ ...rule, inputProperty: '' }]), /inputProperty should be a non-empty string/);
  });

  it('refuses a rule without an error to answer with, and a value that is not a list of rules', () => {
    assert.throws(() => register([{ inputProperty: 'headers.x-role', expectedValue: 'admin' }]), /statusCode/);
    assert.throws(() => register([{ ...rule, message: '' }]), /message/);
    assert.throws(() => register(rule), /accessControl should be an array of rules/);
    assert.throws(() => register([null]), /accessControl\[0\] should be an object/);
    assert.throws(
      () => register([{ ...rule, accessControlHandler: 'yes' }]),
      /accessControlHandler should be a function/,
    );
  });
});
