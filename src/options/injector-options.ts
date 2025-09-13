import { AladoServer } from '@alado';
import { FilePropertyDefinition, PropertyDefinition, RequestAuthentication } from '@dto';

export type InjectorOptions = {
  appMapping: Record<string, AladoServer>;
  authMapping: Record<string, RequestAuthentication>;
  requestMapping: Record<string, Record<string, Record<string, PropertyDefinition | FilePropertyDefinition>>>;
  responseMapping: Record<string, any>;
  propertyDefinitionsMapping: Record<string, Record<string, PropertyDefinition | FilePropertyDefinition>>;
};
