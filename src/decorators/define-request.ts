import { FilePropertyDefinition, PropertyDefinition, Request } from '@dto';
import { injector } from '@injector';
import { AnyClass } from '@options';
import { initializeInjector } from './initialize-injector';
export function defineRequest(request: Partial<Record<keyof Request, AnyClass>>) {
  initializeInjector();
  return function (...args: any[]) {
    if (!injector.injected.requestMapping) {
      injector.injected.requestMapping = {};
    }
    const key: string = `${args[0].constructor.name}.${args[1]}`;
    const r: Record<string, Record<string, PropertyDefinition | FilePropertyDefinition>> = {};
    for (const k in request) {
      const className = request[k as keyof Request].name;
      r[k] = injector.injected.propertyDefinitionsMapping[className];
      injector.injected.requestMapping[key] = r;
    }
  };
}
