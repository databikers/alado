import { RequestAuthentication } from '@dto';
import { injector } from '@injector';

export function withAuth(requestAuthentication: RequestAuthentication) {
  return function (...args: any[]) {
    const [
      controller,
      method,
    ] = args;
    const key = `${controller.constructor.name}.${method}`;
    injector.injected.authMapping[key] = requestAuthentication;
  };
}
