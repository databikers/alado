import { OpenApiDocObject } from '@dto';

function isOpenApiDocObject(obj: any) {
  return obj && typeof obj === 'object' && obj.type;
}

export function docObjectSetter(source: any, target: OpenApiDocObject) {
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !isOpenApiDocObject(source[key])) {
      target.properties[key] = { type: 'object', properties: {} };
      docObjectSetter(source[key], target.properties[key]);
    } else {
      if (isOpenApiDocObject(source[key])) {
        target.properties[key] = source[key];
      } else {
        target.properties[key] = target.properties[key] || {};
        target.properties[key].type = Array.isArray(source.properties[key]) ? 'array' : typeof source.properties[key];
      }
    }
  }
}
