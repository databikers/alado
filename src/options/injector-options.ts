import { AladoServer } from '@alado';
import { AccessControlConfig, ContextAuth, FilePropertyDefinition, PropertyDefinition } from '@dto';

export type InjectorOptions = {
  appMapping: Record<string, AladoServer>;
  shadowAppMapping: Record<string, any>;
  authMapping: Record<string, ContextAuth>;
  accessControlMapping: Record<string, AccessControlConfig<any>[]>;
  requestMapping: Record<string, Record<string, Record<string, PropertyDefinition | FilePropertyDefinition>>>;
  responseMapping: Record<string, any>;
  controllers: Record<string, Object>;
  propertyDefinitionsMapping: Record<string, Record<string, PropertyDefinition | FilePropertyDefinition>>;
};
