import { PropertyDefinition, PropertyValidation } from '@dto';
import { injector } from '@injector';
import { initializeInjector } from './initialize-injector';
import { classKey } from './class-key';

export function transformProperty(propertyTransformer: (value: any) => any | Promise<any>) {
  initializeInjector();
  return function (...args: any[]) {
    if (!injector.injected.propertyDefinitionsMapping) {
      injector.injected.propertyDefinitionsMapping = {};
    }
    const key = classKey(args[0].constructor);
    injector.injected.propertyDefinitionsMapping[key] =
      injector.injected.propertyDefinitionsMapping[key] || ({} as Record<string, PropertyDefinition>);
    injector.injected.propertyDefinitionsMapping[key][args[1] as string] =
      injector.injected.propertyDefinitionsMapping[key][args[1] as string] || ({} as PropertyDefinition);
    (injector.injected.propertyDefinitionsMapping[key][args[1] as string] as PropertyDefinition).transform =
      propertyTransformer;
  };
}
