import { FilePropertyDefinition, PropertyDefinition, Request } from '@dto';
import { injector } from '@injector';
export function defineRequest(rr: Partial<Record<keyof Request, any>>) {
  return function (...args: any[]) {
    const key: string = `${args[0].constructor.name}.${args[1]}`;
    const r: Record<string, Record<string, PropertyDefinition | FilePropertyDefinition>> = {};
    for (const k in rr) {
      const className = rr[k as keyof Request].name;
      r[k] = injector.injected.propertyDefinitionsMapping[className];
      injector.injected.requestMapping[key] = r;
    }
  };
}
