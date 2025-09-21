import { RequestAuthentication } from '@dto';
import { injector } from '@injector';
import { initializeInjector } from './initialize-injector';

export function withAuth(requestAuthentication: RequestAuthentication) {
  initializeInjector();
  return function (...args: any[]) {
    const [
      controller,
      method,
    ] = args;
    const key = `${controller.constructor.name}.${method}`;
    injector.injected.authMapping[key] = requestAuthentication;
  };
}
