import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AladoServer, Request, defineResponse, get, initializeApplication } from '../../src';
import { clientIp } from '../../src/request-processor/request-processor';
import { baseOptions, close, listen, send } from '../helpers/http';

const json = { 'Content-Type': 'application/json' };
const doc = defineResponse({ statusCode: 200, headers: json, body: { ip: '127.0.0.1' } });

class DefaultIpController {
  @get('/ip', { appId: 'trust-proxy-default' })
  @doc
  async ip(req: Request) {
    return { statusCode: 200, headers: json, body: { ip: req.ip } };
  }
}

class OneHopIpController {
  @get('/ip', { appId: 'trust-proxy-one' })
  @doc
  async ip(req: Request) {
    return { statusCode: 200, headers: json, body: { ip: req.ip } };
  }
}

const fakeRequest = (forwardedFor: string | undefined, remoteAddress: string = '10.0.0.1'): any => ({
  headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
  socket: { remoteAddress },
});

let plain: AladoServer;
let behindProxy: AladoServer;
let plainPort: number;
let proxyPort: number;

before(async () => {
  plain = initializeApplication({
    serverOptions: baseOptions('trust-proxy-default'),
    controllers: [DefaultIpController],
  });
  behindProxy = initializeApplication({
    serverOptions: baseOptions('trust-proxy-one', { trustProxy: 1 }),
    controllers: [OneHopIpController],
  });
  plainPort = await listen(plain);
  proxyPort = await listen(behindProxy);
});

after(async () => {
  await close(plain);
  await close(behindProxy);
});

describe('request.ip', () => {
  it('ignores X-Forwarded-For by default', async () => {
    const r = await send(plainPort, { path: '/ip', headers: { 'X-Forwarded-For': '6.6.6.6' } });
    assert.equal(r.json().ip, '127.0.0.1');
  });

  it('with trustProxy: 1 takes the address added by the one trusted proxy', async () => {
    // the client forged "6.6.6.6"; the proxy appended the real client address
    const r = await send(proxyPort, { path: '/ip', headers: { 'X-Forwarded-For': '6.6.6.6, 203.0.113.7' } });
    assert.equal(r.json().ip, '203.0.113.7');
  });

  it('resolves each trustProxy mode', () => {
    const req = fakeRequest('6.6.6.6, 203.0.113.7, 10.0.0.2');
    assert.equal(clientIp(req, false), '10.0.0.1');
    assert.equal(clientIp(req, undefined), '10.0.0.1');
    assert.equal(clientIp(req, true), '6.6.6.6');
    assert.equal(clientIp(req, 0), '10.0.0.1');
    assert.equal(clientIp(req, 1), '10.0.0.2');
    assert.equal(clientIp(req, 2), '203.0.113.7');
    assert.equal(clientIp(req, 10), '6.6.6.6');
  });

  it('falls back to the socket address without a usable header', () => {
    assert.equal(clientIp(fakeRequest(undefined), 1), '10.0.0.1');
    assert.equal(clientIp(fakeRequest(' , '), true), '10.0.0.1');
  });

  it('never returns a forwarded entry that is not an IP address', () => {
    const injected = "<script>alert(1)</script>' OR 1=1 --";
    // trustProxy: true skips to the left-most real address, or falls back to the socket
    assert.equal(clientIp(fakeRequest(`${injected}, 203.0.113.7`), true), '203.0.113.7');
    assert.equal(clientIp(fakeRequest(injected), true), '10.0.0.1');
    assert.equal(clientIp(fakeRequest('x'.repeat(4000)), true), '10.0.0.1');
    // a hop count that lands on something else than an address falls back to the socket
    assert.equal(clientIp(fakeRequest(`203.0.113.7, ${injected}`), 1), '10.0.0.1');
    assert.equal(clientIp(fakeRequest(`${injected}, 10.0.0.2`), 2), '10.0.0.1');
  });

  it('accepts IPv6 and the forms with a port some proxies write', () => {
    assert.equal(clientIp(fakeRequest('2001:db8::1'), true), '2001:db8::1');
    assert.equal(clientIp(fakeRequest('203.0.113.7:51234'), true), '203.0.113.7');
    assert.equal(clientIp(fakeRequest('[2001:db8::1]:443'), true), '2001:db8::1');
    assert.equal(clientIp(fakeRequest('6.6.6.6, 203.0.113.7:51234'), 1), '203.0.113.7');
    assert.equal(clientIp(fakeRequest('999.1.1.1:80, [zz::1]:1'), true), '10.0.0.1');
  });

  it('rejects an invalid trustProxy option', () => {
    assert.throws(
      () => new AladoServer(baseOptions('trust-proxy-invalid', { trustProxy: 'yes' }) as any),
      /trustProxy should be a boolean or a non-negative integer/,
    );
    assert.throws(() => new AladoServer(baseOptions('trust-proxy-invalid', { trustProxy: -1 }) as any));
  });
});
