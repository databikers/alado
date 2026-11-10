import { FilePropertyDefinition, PropertyDefinition, Request } from '@dto';
import { injector } from '@injector';
import { AnyClass } from '@options';
import { initializeInjector } from './initialize-injector';
import { classKey, memberKey } from './class-key';
import { assertNotRegistered } from './registered-members';

/**
 * The decorated properties of a DTO class and of the classes it extends. Each class keeps its own
 * entry (keyed by the class the decorator ran on), so a DTO that extends another would otherwise
 * lose the parent's fields: not validated, not required, and stripped as unknown. A property
 * decorated again in a subclass replaces the parent's definition.
 */
function inheritedDefinitions(dto: AnyClass): Record<string, PropertyDefinition | FilePropertyDefinition> | undefined {
  const chain: object[] = [];
  for (
    let ctor: any = dto;
    typeof ctor === 'function' && ctor !== Function.prototype;
    ctor = Object.getPrototypeOf(ctor)
  ) {
    chain.unshift(ctor);
  }
  let merged: Record<string, PropertyDefinition | FilePropertyDefinition> | undefined;
  for (const ctor of chain) {
    const own = injector.injected.propertyDefinitionsMapping?.[classKey(ctor)];
    if (own) {
      merged = { ...merged, ...own };
    }
  }
  return merged;
}

export function defineRequest(request: Partial<Record<keyof Request, AnyClass>>) {
  initializeInjector();
  return function (...args: any[]) {
    if (!injector.injected.requestMapping) {
      injector.injected.requestMapping = {};
    }
    const key: string = memberKey(args[0], args[1]);
    assertNotRegistered(key, 'defineRequest');
    const r: Record<string, Record<string, PropertyDefinition | FilePropertyDefinition>> = {};
    for (const k in request) {
      const dto = request[k as keyof Request];
      r[k] = dto ? inheritedDefinitions(dto) : (undefined as any);
      injector.injected.requestMapping[key] = r;
    }
  };
}
