import { RequestAuthentication } from '@dto';
import { injector } from '@injector';
import { initializeInjector } from './initialize-injector';
import { memberKey } from './class-key';
import { assertNotRegistered } from './registered-members';

export function withAuth(requestAuthentication: RequestAuthentication) {
  initializeInjector();
  return function (...args: any[]) {
    const [
      controller,
      method,
    ] = args;
    const key = memberKey(controller, method);
    assertNotRegistered(key, 'withAuth');
    injector.injected.authMapping[key] = requestAuthentication;
  };
}
