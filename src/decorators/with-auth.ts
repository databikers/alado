import { RequestAuthentication } from '@dto';
import { injector } from '@injector';
import { initializeInjector } from './initialize-injector';
import { memberKey } from './class-key';

export function withAuth(requestAuthentication: RequestAuthentication) {
  initializeInjector();
  return function (...args: any[]) {
    const [
      controller,
      method,
    ] = args;
    const key = memberKey(controller, method);
    injector.injected.authMapping[key] = requestAuthentication;
  };
}
