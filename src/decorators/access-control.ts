import { AccessControlConfig, RequestAuthentication } from '@dto';
import { injector } from '@injector';
import { initializeInjector } from './initialize-injector';
import { memberKey } from './class-key';

export function accessControl(configs: AccessControlConfig<any>[]) {
  initializeInjector();
  return function (...args: any[]) {
    const [
      controller,
      method,
    ] = args;
    const key = memberKey(controller, method);
    injector.injected.accessControlMapping[key] = configs;
  };
}
