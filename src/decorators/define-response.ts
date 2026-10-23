import { injector } from '@injector';
import { Response } from '@dto';
import { initializeInjector } from './initialize-injector';
import { memberKey } from './class-key';

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
    const key = memberKey(controller, method);
    injector.injected.responseMapping[key] = response;
  };
}
