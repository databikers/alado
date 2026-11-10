import { Context } from '@dto';
import { docObjectSetter } from '@helper';

// media types whose body is described property by property (the media type without parameters)
function isStructured(mediaType: string): boolean {
  return (
    mediaType === 'application/json' ||
    mediaType === 'application/xml' ||
    mediaType === 'text/xml' ||
    /^application\/[\w.+-]+\+(json|xml)$/.test(mediaType)
  );
}

// statuses that never carry content (RFC 9110 15.3.5, 15.4.5)
const noContentStatuses: Set<number> = new Set([
  204,
  304,
]);

// "/users/{id}/avatar" -> "UsersByIdAvatar"
function pascalPath(route: string): string {
  return route
    .split('/')
    .filter(Boolean)
    .map((segment: string) => {
      const param: RegExpExecArray | null = /^\{(.+)\}$/.exec(segment);
      const words: string = (param ? `by-${param[1]}` : segment)
        .split(/[^a-zA-Z0-9]+/)
        .filter(Boolean)
        .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
        .join('');
      return words;
    })
    .join('');
}

/**
 * The component name of a route's response schema. A response that names its `entity` shares that
 * schema with every route naming the same entity; otherwise the name is the route's own
 * ("GetUsersById200"), so two routes never overwrite each other's schema (a shared title such as
 * "OK" or a missing one used to put every such response under one name).
 */
// which route owns each generated schema name, per document
const generatedNames: WeakMap<object, Map<string, string>> = new WeakMap();

function responseSchemaName(
  openApiDocObject: object,
  openApiMethod: string,
  openApiRoute: string,
  statusCode: number,
  entity?: string,
): string {
  if (entity) {
    // OpenAPI component names allow letters, digits, '.', '-' and '_' only ("User Profile" -> "User_Profile")
    return entity.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  }
  // routes that differ only in punctuation or a param ("/users/{id}", "/users/by-id", "/user_list",
  // "/user-list") build the same name: the later one gets a suffix instead of replacing the first
  let owners: Map<string, string> | undefined = generatedNames.get(openApiDocObject);
  if (!owners) {
    owners = new Map();
    generatedNames.set(openApiDocObject, owners);
  }
  const owner: string = `${openApiMethod} ${openApiRoute} ${statusCode}`;
  const base: string = `${openApiMethod.charAt(0).toUpperCase()}${openApiMethod.slice(1).toLowerCase()}${pascalPath(openApiRoute)}${statusCode}`;
  let name: string = base;
  for (let n: number = 2; owners.has(name) && owners.get(name) !== owner; n++) {
    name = `${base}_${n}`;
  }
  owners.set(name, owner);
  return name;
}

function documentResponse(openApiMethod: string, openApiRoute: string, context: Context<any>, openApiDocObject: any) {
  const { statusCode, headers, body, description, title, entity } = context.response;
  const declaredType: string | undefined = headers
    ? Object.entries(headers as Record<string, string>).find(([name]) => name.toLowerCase() === 'content-type')?.[1]
    : undefined;
  // OpenAPI requires a description; the title, or the status, stands in for a missing one
  const response: any = { description: description || title || `${statusCode} response` };
  if (!noContentStatuses.has(statusCode) && (body || declaredType)) {
    // an object body without a Content-Type is sent as JSON
    const contentType: string = declaredType || 'application/json';
    const mediaType: string = contentType.split(';')[0].trim().toLowerCase();
    if (body) {
      const sample: any = Array.isArray(body) ? body[0] : body;
      let schema: any;
      if (isStructured(mediaType)) {
        schema = { properties: {}, type: 'object' };
        docObjectSetter(sample, schema);
      } else {
        schema = { example: '' };
      }
      const name: string = responseSchemaName(openApiDocObject, openApiMethod, openApiRoute, statusCode, entity);
      openApiDocObject.components.schemas[name] = schema;
      const ref: any = { $ref: `#/components/schemas/${name}` };
      response.content = {
        [contentType]: {
          schema: Array.isArray(body) ? { type: 'array', items: ref } : ref,
        },
      };
    } else {
      response.content = { [contentType]: { example: '' } };
    }
  }
  openApiDocObject.paths[openApiRoute][openApiMethod].responses = { [statusCode]: response };
}

export function openApiDocFactory(
  openApiMethod: string,
  openApiRoute: string,
  context: Context<any>,
  openApiDocObject: any,
) {
  // validate params
  openApiRoute = openApiRoute.toString().replace(/\/$/, '');
  // Docs part
  openApiDocObject.paths[openApiRoute] = openApiDocObject.paths[openApiRoute] || {};
  // both are optional in a Context (the router fills in `request` only after this runs)
  const openApiDoc = context.options?.openApiDoc;
  openApiDocObject.paths[openApiRoute][openApiMethod] = { ...openApiDoc, parameters: [] };
  const { title } = context;
  if (context.auth) {
    const { inputProperty, required } = context.auth;
    const [
      where,
      what,
    ] = inputProperty.split('.');
    // an OpenAPI apiKey lives in a header, the query or a cookie: a credential read from the body or
    // the path is documented by that field alone, not as a security scheme
    const location: string | undefined = { headers: 'header', query: 'query' }[where.toLowerCase()];
    if (location) {
      const authStrategyName: string = where.toLowerCase() + what.charAt(0).toUpperCase() + what.slice(1);
      if (!openApiDocObject.components.securitySchemes[authStrategyName]) {
        openApiDocObject.components.securitySchemes[authStrategyName] = {
          type: 'apiKey',
          in: location,
          name: location === 'header' ? what.toLowerCase() : what,
        };
      }
      // optional auth: the empty requirement lets a request without the credential through
      openApiDocObject.paths[openApiRoute][openApiMethod].security =
        required === false
          ? [
              { [authStrategyName]: [] },
              {},
            ]
          : [{ [authStrategyName]: [] }];
    }
  }
  const { headers, body, path, query, files } = context.request || {};
  if (headers) {
    for (const header in headers) {
      openApiDocObject.paths[openApiRoute][openApiMethod].parameters.push({
        in: 'header',
        name: header,
        required: headers[header].validation.required || false,
        schema: headers[header].openApiDoc?.schema,
        description: headers[header].openApiDoc?.description,
        example: headers[header].openApiDoc?.example,
      });
    }
  }
  // OpenAPI 3: every {param} of the path has to be declared, with required: true
  for (const [
    ,
    param,
  ] of openApiRoute.matchAll(/\{([^}]+)\}/g)) {
    const definition = path?.[param];
    openApiDocObject.paths[openApiRoute][openApiMethod].parameters.push({
      in: 'path',
      name: param,
      required: true,
      schema: definition?.openApiDoc?.schema || { type: 'string' },
      description: definition?.openApiDoc?.description,
      example: definition?.openApiDoc?.example,
    });
  }
  if (query) {
    for (const param in query) {
      openApiDocObject.paths[openApiRoute][openApiMethod].parameters.push({
        in: 'query',
        name: param,
        required: query[param].validation?.required || false,
        schema: query[param].openApiDoc?.schema,
        description: query[param].openApiDoc?.description,
        example: query[param].openApiDoc?.example,
      });
    }
  }
  if (files && Object.keys(files).length) {
    const uploadObject: any = {
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            properties: {},
          },
        },
      },
    };
    for (const param in files) {
      uploadObject.content['multipart/form-data'].schema.properties[param] = {
        type: 'string',
        format: 'binary',
      };
    }
    if (body) {
      for (const prop in body) {
        uploadObject.content['multipart/form-data'].schema.properties[prop] = body[prop].openApiDoc?.schema;
      }
    }
    const required: string[] = [
      ...Object.keys(files).filter((name: string) => files[name].required),
      ...Object.keys(body || {}).filter((name: string) => body?.[name]?.validation?.required),
    ];
    if (required.length) {
      uploadObject.required = true;
      uploadObject.content['multipart/form-data'].schema.required = required;
    }
    openApiDocObject.paths[openApiRoute][openApiMethod].requestBody = uploadObject;
  }
  if (body && (!files || !Object.keys(files).length)) {
    const contentType: string = 'application/json';
    // openApiDocObject.paths[openApiRoute][openApiMethod].consumes = ['application/json', 'form-data', 'x-www-form-urlencoded'];
    const bodyObject: any = {
      content: {
        [contentType]: {
          schema: {
            type: 'object',
            properties: {},
          },
        },
      },
    };
    for (const prop in body) {
      bodyObject.content[contentType].schema.properties[prop] = body[prop]?.openApiDoc?.schema;
    }
    const required: string[] = Object.keys(body).filter((name: string) => body[name]?.validation?.required);
    if (required.length) {
      bodyObject.required = true;
      bodyObject.content[contentType].schema.required = required;
    }
    openApiDocObject.paths[openApiRoute][openApiMethod].requestBody = bodyObject;
  }
  if (context.response) {
    documentResponse(openApiMethod, openApiRoute, context, openApiDocObject);
  }
}
