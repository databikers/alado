import { PropertyDefinition, PropertyValidation } from '@dto';
import { injector } from '@injector';
import { initializeInjector } from './initialize-injector';

export function validateProperty(propertyValidation: PropertyValidation) {
  initializeInjector();
  return function (...args: any[]) {
    if (!injector.injected.propertyDefinitionsMapping) {
      injector.injected.propertyDefinitionsMapping = {};
    }
    const key = args[0].constructor.name;
    injector.injected.propertyDefinitionsMapping[key] =
      injector.injected.propertyDefinitionsMapping[key] || ({} as Record<string, PropertyDefinition>);
    injector.injected.propertyDefinitionsMapping[key][args[1] as string] =
      injector.injected.propertyDefinitionsMapping[key][args[1] as string] || ({} as PropertyDefinition);
    (injector.injected.propertyDefinitionsMapping[key][args[1] as string] as PropertyDefinition).validation =
      propertyValidation;
  };
}
