import { AladoServerError } from './alado-server-error';

export type PropertyDefinitionSchema = {
  type?: string;
  format?: string;
  default?: any;
  $ref?: string;
  nullable?: boolean;
  readOnly?: boolean;
  writeOnly?: boolean;
  deprecated?: boolean;
  enum?: any[];
  oneOf?: Array<PropertyDefinitionSchema>;
  anyOf?: Array<PropertyDefinitionSchema>;
  allOf?: Array<PropertyDefinitionSchema>;
  not?: Array<PropertyDefinitionSchema>;
  properties?: Record<string, PropertyDefinitionSchema>;
  additionalProperties?: PropertyDefinitionSchema;
  minProperties?: number;
  maxProperties?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  items?: PropertyDefinitionSchema;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
};

export type PropertyDocumentation = {
  schema: PropertyDefinitionSchema;
  description?: string;
  example?: any;
};

export type PropertyValidation = {
  required?: boolean;
  handler: (value: any) => boolean | Promise<boolean>;
  error: AladoServerError;
};

export type PropertyDefinition = {
  isJSON?: boolean;
  validation: PropertyValidation; // apply in what context
  openApiDoc?: PropertyDocumentation;
  transform?: (value: any) => any | Promise<any>;
};

export type FilePropertyDefinition = {
  mimetypes: string[];
  maxSize: number;
  required: boolean;
  mimetypeError: AladoServerError;
  maxSizeError: AladoServerError;
  requiredError: AladoServerError;
};
