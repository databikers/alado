import { injector } from '@injector';
import { Response } from '@dto';
import { initializeInjector } from './initialize-injector';
import { memberKey } from './class-key';
import { assertNotRegistered } from './registered-members';

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
    assertNotRegistered(key, 'defineResponse');
    injector.injected.responseMapping[key] = response;
  };
}
