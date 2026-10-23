import { FilePropertyDefinition, PropertyDefinition, Request } from '@dto';
import { injector } from '@injector';
import { AnyClass } from '@options';
import { initializeInjector } from './initialize-injector';
import { classKey, memberKey } from './class-key';

export function defineRequest(request: Partial<Record<keyof Request, AnyClass>>) {
  initializeInjector();
  return function (...args: any[]) {
    if (!injector.injected.requestMapping) {
      injector.injected.requestMapping = {};
    }
    const key: string = memberKey(args[0], args[1]);
    const r: Record<string, Record<string, PropertyDefinition | FilePropertyDefinition>> = {};
    for (const k in request) {
      const dto = request[k as keyof Request];
      const className: string | undefined = dto ? classKey(dto) : undefined;
      r[k] = injector.injected.propertyDefinitionsMapping[className as string];
      injector.injected.requestMapping[key] = r;
    }
  };
}
