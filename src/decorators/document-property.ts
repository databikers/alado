import { PropertyDefinition, PropertyDocumentation } from '@dto';
import { injector } from '@injector';
import { initializeInjector } from './initialize-injector';
import { classKey } from './class-key';

export function documentProperty(propertyDocumentation: PropertyDocumentation) {
  initializeInjector();
  return function (...args: any[]) {
    if (!injector.injected.propertyDefinitionsMapping) {
      injector.injected.propertyDefinitionsMapping = {};
    }
    const key = classKey(args[0].constructor);
    const { propertyDefinitionsMapping } = injector.injected;
    propertyDefinitionsMapping[key] = propertyDefinitionsMapping[key] || ({} as Record<string, PropertyDefinition>);
    propertyDefinitionsMapping[key][args[1] as string] =
      propertyDefinitionsMapping[key][args[1] as string] || ({} as PropertyDefinition);
    (propertyDefinitionsMapping[key][args[1] as string] as PropertyDefinition).openApiDoc = propertyDocumentation;
  };
}
