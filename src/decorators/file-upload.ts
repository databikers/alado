import { FilePropertyDefinition, PropertyDefinition } from '@dto';
import { injector } from '@injector';

export function fileUpload(filePropertyDefinition: FilePropertyDefinition) {
  return function (...args: any[]) {
    const key = args[0].constructor.name;
    injector.injected.propertyDefinitionsMapping[key] =
      injector.injected.propertyDefinitionsMapping[key] ||
      ({} as Record<string, PropertyDefinition | FilePropertyDefinition>);
    injector.injected.propertyDefinitionsMapping[key][args[1] as string] = filePropertyDefinition;
  };
}
