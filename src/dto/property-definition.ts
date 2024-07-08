import { AladoServerError } from './alado-server-error';

export interface PropertyDefinitionSchema {
  type?: string;
  $ref?: string;
  enum?: any[];
  items?: PropertyDefinitionSchema;
}
export interface PropertyDocumentation {
  schema: PropertyDefinitionSchema;
  description?: string;
  example?: any;
}

export interface PropertyValidation {
  required?: boolean;
  handler: (value: any) => boolean | Promise<boolean>;
  error: AladoServerError;
}

export interface PropertyDefinition {
  validation: PropertyValidation; // apply in what context
  openApiDoc?: PropertyDocumentation;
  transform?: (value: any) => any | Promise<any>;
}

export interface FilePropertyDefinition {
  mimetypes: string[];
  maxSize: number;
  required: boolean;
  mimetypeError: AladoServerError;
  maxSizeError: AladoServerError;
  requiredError: AladoServerError;
}
