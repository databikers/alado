import { FilePropertyDefinition, PropertyDefinition } from '@dto';
import { injector } from '@injector';
import { initializeInjector } from './initialize-injector';
import { classKey } from './class-key';

export function fileUploadProperty(filePropertyDefinition: FilePropertyDefinition) {
  initializeInjector();
  return function (...args: any[]) {
    const key = classKey(args[0].constructor);
    injector.injected.propertyDefinitionsMapping[key] =
      injector.injected.propertyDefinitionsMapping[key] ||
      ({} as Record<string, PropertyDefinition | FilePropertyDefinition>);
    injector.injected.propertyDefinitionsMapping[key][args[1] as string] = filePropertyDefinition;
  };
}
