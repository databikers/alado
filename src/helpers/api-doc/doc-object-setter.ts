import { OpenApiDocObject } from '@dto';

const schemaTypes: Set<string> = new Set([
  'string',
  'number',
  'integer',
  'boolean',
  'array',
  'object',
]);
const schemaKeywords: Set<string> = new Set([
  'type',
  '$ref',
  'format',
  'title',
  'description',
  'default',
  'example',
  'nullable',
  'readOnly',
  'writeOnly',
  'deprecated',
  'properties',
  'required',
  'enum',
  'oneOf',
  'anyOf',
  'allOf',
  'not',
  'additionalProperties',
  'minProperties',
  'maxProperties',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'items',
  'minItems',
  'maxItems',
  'uniqueItems',
]);

/**
 * Whether a value in a response example is an OpenAPI schema written by hand rather than example
 * data: it names a schema type (or a $ref) and has schema keywords only. `{ type: 'admin', name }`
 * is data that happens to have a field called "type".
 */
function isOpenApiDocObject(obj: any): boolean {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return false;
  }
  const typed: boolean = (typeof obj.type === 'string' && schemaTypes.has(obj.type)) || typeof obj.$ref === 'string';
  return typed && Object.keys(obj).every((key: string) => schemaKeywords.has(key));
}

/** The schema of one example value: arrays by their first item, objects by their properties. */
function schemaOf(value: any): any {
  if (value === null || value === undefined) {
    return { nullable: true };
  }
  if (Array.isArray(value)) {
    return { type: 'array', items: value.length ? schemaOf(value[0]) : {} };
  }
  if (value instanceof Date) {
    return { type: 'string', format: 'date-time' };
  }
  if (typeof value === 'object') {
    if (isOpenApiDocObject(value)) {
      return value;
    }
    const schema: OpenApiDocObject = { type: 'object', properties: {} } as OpenApiDocObject;
    docObjectSetter(value, schema);
    return schema;
  }
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return { type: typeof value };
    case 'bigint':
      return { type: 'integer' };
    default:
      return {};
  }
}

export function docObjectSetter(source: any, target: OpenApiDocObject) {
  for (const key in source) {
    target.properties[key] = schemaOf(source[key]);
  }
}
