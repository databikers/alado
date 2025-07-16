import { Context } from '@dto';

const nonBinResponses = [
  'application/json',
  'application/xml',
];

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
  const { openApiDoc } = context.options;
  openApiDocObject.paths[openApiRoute][openApiMethod] = { ...openApiDoc, parameters: [] };
  const { title } = context;
  if (context.auth) {
    const { inputProperty } = context.auth;
    const [
      where,
      what,
    ] = inputProperty.split('.');
    const authStrategyName: string = where.toLowerCase() + what.charAt(0).toUpperCase() + what.slice(1);
    if (!openApiDocObject.components.securitySchemes[authStrategyName]) {
      openApiDocObject.components.securitySchemes[authStrategyName] = {
        type: 'apiKey',
        in: where.replace(/s$/, '').toLowerCase(),
        name: what.toLowerCase(),
      };
    }
    openApiDocObject.paths[openApiRoute][openApiMethod].security = [{ [authStrategyName]: [] }];
  }
  const { headers, body, path, query, files } = context.request;
  if (headers) {
    for (const header in headers) {
      openApiDocObject.paths[openApiRoute][openApiMethod].parameters.push({
        in: 'headers',
        name: header,
        required: headers[header].validation.required || false,
        schema: headers[header].openApiDoc.schema,
        description: headers[header].openApiDoc.description,
        example: headers[header].openApiDoc.example,
      });
    }
  }
  if (path) {
    for (const param in path) {
      openApiDocObject.paths[openApiRoute][openApiMethod].parameters.push({
        in: 'path',
        name: param,
        required: path[param].validation.required || false,
        schema: path[param].openApiDoc.schema,
        description: path[param].openApiDoc.description,
        example: path[param].openApiDoc.example,
      });
    }
  }
  if (query) {
    for (const param in query) {
      openApiDocObject.paths[openApiRoute][openApiMethod].parameters.push({
        in: 'query',
        name: param,
        required: query[param].validation.required || false,
        schema: query[param].openApiDoc.schema,
        description: query[param].openApiDoc.description,
        example: query[param].openApiDoc.example,
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
        uploadObject.content['multipart/form-data'].schema.properties[prop] = body[prop].openApiDoc.schema;
      }
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
      bodyObject.content[contentType].schema.properties[prop] = body[prop].openApiDoc.schema;
    }
    openApiDocObject.paths[openApiRoute][openApiMethod].requestBody = bodyObject;
  }
  if (context.response) {
    const { statusCode, headers, body, description, title } = context.response;
    const responseContentType = headers['Content-Type'] || headers['content-type'];
    if (body) {
      if (Array.isArray(body)) {
        let bodyObject: any = {};
        if (nonBinResponses.includes(responseContentType)) {
          bodyObject = { properties: {} };
          for (const prop in body[0]) {
            bodyObject.properties[prop] = body[0][prop];
          }
        } else {
          bodyObject = { example: '' };
        }
        openApiDocObject.components.schemas[title] = bodyObject;
        openApiDocObject.paths[openApiRoute][openApiMethod].responses = {
          [statusCode]: {
            description,
            content: {
              [responseContentType]: {
                schema: {
                  type: 'array',
                  items: {
                    $ref: `#/components/schemas/${title}`,
                  },
                },
              },
            },
          },
        };
      } else {
        let bodyObject: any = {};
        if (nonBinResponses.includes(responseContentType)) {
          bodyObject = { properties: {} };
          for (const prop in body) {
            bodyObject.properties[prop] = body[prop];
          }
        } else {
          bodyObject = { example: '' };
        }
        openApiDocObject.components.schemas[title] = bodyObject;
        openApiDocObject.paths[openApiRoute][openApiMethod].responses = {
          [statusCode]: {
            description,
            content: {
              [responseContentType]: {
                schema: {
                  $ref: `#/components/schemas/${title}`,
                },
              },
            },
          },
        };
      }
    } else {
      openApiDocObject.paths[openApiRoute][openApiMethod].responses = {
        [statusCode]: {
          description,
          content: {
            [responseContentType]: {
              example: '',
            },
          },
        },
      };
    }
  }
}
