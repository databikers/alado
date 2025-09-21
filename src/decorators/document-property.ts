import { PropertyDefinition, PropertyDocumentation } from '@dto';
import { injector } from '@injector';
import { initializeInjector } from './initialize-injector';

export function documentProperty(propertyDocumentation: PropertyDocumentation) {
  initializeInjector();
  return function (...args: any[]) {
    if (!injector.injected.propertyDefinitionsMapping) {
      injector.injected.propertyDefinitionsMapping = {};
    }
    const key = args[0].constructor.name;
    const { propertyDefinitionsMapping } = injector.injected;
    propertyDefinitionsMapping[key] = propertyDefinitionsMapping[key] || ({} as Record<string, PropertyDefinition>);
    propertyDefinitionsMapping[key][args[1] as string] =
      propertyDefinitionsMapping[key][args[1] as string] || ({} as PropertyDefinition);
    (propertyDefinitionsMapping[key][args[1] as string] as PropertyDefinition).openApiDoc = propertyDocumentation;
  };
}
