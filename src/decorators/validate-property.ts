import { PropertyDefinition, PropertyValidation } from '@dto';
import { injector } from '@injector';

export function validateProperty(propertyValidation: PropertyValidation) {
  return function (...args: any[]) {
    const key = args[0].constructor.name;
    injector.injected.propertyDefinitionsMapping[key] =
      injector.injected.propertyDefinitionsMapping[key] || ({} as Record<string, PropertyDefinition>);
    injector.injected.propertyDefinitionsMapping[key][args[1] as string] =
      injector.injected.propertyDefinitionsMapping[key][args[1] as string] || ({} as PropertyDefinition);
    (injector.injected.propertyDefinitionsMapping[key][args[1] as string] as PropertyDefinition).validation =
      propertyValidation;
  };
}
