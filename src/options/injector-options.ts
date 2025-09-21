import { AladoServer } from '@alado';
import { FilePropertyDefinition, PropertyDefinition, RequestAuthentication } from '@dto';

export type InjectorOptions = {
  appMapping: Record<string, AladoServer>;
  shadowAppMapping: Record<string, any>;
  authMapping: Record<string, RequestAuthentication>;
  requestMapping: Record<string, Record<string, Record<string, PropertyDefinition | FilePropertyDefinition>>>;
  responseMapping: Record<string, any>;
  controllers: Record<string, Object>;
  propertyDefinitionsMapping: Record<string, Record<string, PropertyDefinition | FilePropertyDefinition>>;
};
