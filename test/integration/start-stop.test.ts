import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { AladoServer } from '../../src';
import { baseOptions } from '../helpers/http';

const started = (app: AladoServer) => new Promise<Error | undefined>((resolve) => app.start(resolve));
const stopped = (app: AladoServer) => new Promise<Error | undefined>((resolve) => app.stop(resolve));

describe('start() and stop() callbacks', () => {
  it('give start() the error when the port is taken, instead of an uncaught exception', async () => {
    const first = new AladoServer(baseOptions('start-stop-1'));
    assert.equal(await started(first), undefined);
    const port = ((first as any).server.address() as AddressInfo).port;
    const second = new AladoServer(baseOptions('start-stop-2', { port }));
    const error: any = await started(second);
    assert.equal(error?.code, 'EADDRINUSE');
    assert.equal(second.listening, false);
    // the port is free again: the same instance can start
    assert.equal(await stopped(first), undefined);
    assert.equal(await started(second), undefined);
    assert.equal(second.listening, true);
    assert.equal(await stopped(second), undefined);
  });

  it('call back when there is nothing to do', async () => {
    const app = new AladoServer(baseOptions('start-stop-3'));
    assert.equal(await stopped(app), undefined, 'stop() before start()');
    assert.equal(await started(app), undefined);
    assert.equal(await started(app), undefined, 'start() when already listening');
    assert.equal(await stopped(app), undefined);
    assert.equal(await stopped(app), undefined, 'stop() twice');
    app.stop();
  });
});
