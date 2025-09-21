import { injector } from '@injector';
import { Response } from '@dto';
import { initializeInjector } from './initialize-injector';

export function defineResponse(response: Response<any>) {
  initializeInjector();
  return function (...args: any[]) {
    if (!injector.injected.responseMapping) {
      injector.injected.responseMapping = {};
    }
    const [
      controller,
      method,
    ] = args;
    const key = `${controller.constructor.name}.${method}`;
    injector.injected.responseMapping[key] = response;
  };
}
