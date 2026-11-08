import { AccessControlConfig } from '@dto';
import { injector } from '@injector';
import { initializeInjector } from './initialize-injector';
import { memberKey } from './class-key';
import { assertNotRegistered } from './registered-members';

export function accessControl(configs: AccessControlConfig<any>[]) {
  initializeInjector();
  return function (...args: any[]) {
    const [
      controller,
      method,
    ] = args;
    const key = memberKey(controller, method);
    assertNotRegistered(key, 'accessControl');
    injector.injected.accessControlMapping[key] = configs;
  };
}
