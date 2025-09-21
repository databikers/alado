Alado is an extremely fast, simple, robust, and lightweight (no-dependency)
for creating server applications written in Node.js and running over the HTTP protocol.

Its main difference from most similar well-known frameworks is that with a minimum of external dependencies
it provides out-of-the-box such fully-functioning features as routing, CORS, automatic API documentation (Open API 3.0),
parsing query and path parameters, and the request body, file uploading, request authentication, etc.

# Documentation for version 2.0.0 and above:
Version 2.0.0 comes with decorators that simplify the project structure and minimize the amount of code you need to write.


There is an example of the API creating with Alado (version >= 2.0.0):
[https://github.com/databikers/alado-decorators-api-example](https://github.com/databikers/alado-decorators-api-example)

## Use inside controllers the next decorators:

### HTTP Method Decorators

```ts
get(path: string, options: HttpDecoratorOptions = {})
post(path: string, options: HttpDecoratorOptions = {})
put(path: string, options: HttpDecoratorOptions = {})
patch(path: string, options: HttpDecoratorOptions = {})
del(path: string, options: HttpDecoratorOptions = {})
head(path: string, options: HttpDecoratorOptions = {})
```

#### Arguments
- **path**: Route string (e.g., `/users/:id`).
- **options**: `HttpDecoratorOptions` object, may include:
  - `appId`: Identifier of the application instance.
  - `title`: A descriptive name of the endpoint.
  - `description`: Documentation text for the endpoint.
  - `tags`: Array of tags for grouping in OpenAPI docs.
  - `isHidden`: Boolean flag to hide the endpoint from OpenAPI output

---

### `defineRequest` decorator

```ts
defineRequest(request: Partial<Record<keyof [Request](#request), AnyClass>>)
```

#### Arguments
- **request**: A partial mapping of keys from [Request](#request) to your DTO classes.
  - Keys can include:
    - `headers`, `query`, `path`, `body`: each a record of property definitions.
    - `files`: mapping of [FilePropertyDefinition](#filepropertydefinition).
    - `auth`: authentication data mapping.
  - Each value points to a class that uses specific DTO decorators to define how that part of the request should be validated and documented.

#### `Request`

```ts
interface Request {
  request: IncomingMessage;
  ip?: string;
  origin?: string;
  method?: HttpMethod;
  url?: string;
  auth?: Record<string, any>;
  path?: Record<string, string>;
  headers?: IncomingHttpHeaders;
  query?: Record<string, any>;
  body?: Record<string, any>;
  rawBody?: string;
  files?: Record<string, { stream: Readable; size: number; mimetype: string }>;
}
```

---

### `defineResponse` decorator

```ts
defineResponse(response: [Response](#response)<any>)
```

#### Arguments
- **response**: Response schema definition, including:
  - `title`: Short descriptive title.
  - `description`: Explanation of the response.
  - `statusCode`: HTTP status code.
  - `headers`: Mapping of header names to values.
  - `body`: Response body object (may be an instance of some DTO or class).

#### `Response`

```ts
interface Response<T> {
  title?: string;
  description?: string;
  statusCode: number;
  headers?: Record<string, string>;
  body?: T;
}
```
---

### `withAuth` decorator

```ts
withAuth(requestAuthentication: [RequestAuthentication](#requestauthentication))
```

#### Arguments
- **requestAuthentication**: Defines authentication requirements, including:
  - `inputProperty`: Field name in request used for auth input.
  - `outputProperty`: Field name in request to store auth result.
  - `handler`: Function to transform/verify authentication value.
  - `handlerContext`: Optional context object passed to handler.
  - `required`: Boolean indicating if authentication is mandatory.
  - `error`: Error object to use when authentication fails.

#### `RequestAuthentication`

```ts
interface RequestAuthentication {
  inputProperty: string;
  outputProperty: string;
  handler: (value: any) => any | Promise<any>;
  handlerContext?: any;
  required: boolean;
  error: AladoServerError;
}
```


```typescript
import { RequestAuthentication } from 'alado';
import { DataStore } from '@data-store';

export const bearerAuth: RequestAuthentication = {
  required: true,
  inputProperty: 'headers.x-api-key',
  outputProperty: 'auth.user',
  handler(value: string) {
    return DataStore.bearerAuth(value);
  },
  error: {
    statusCode: 401,
    message: 'Unauthorized',
  },
};

```

#### `AladoServerError`

```ts
type AladoServerError = {
  statusCode: number;
  message: string;
};
```
---

Example of controller:


```ts
export class UserController {
  @post('/user', { tags: ['User'] })
  @defineResponse({
    statusCode: 201,
    title: 'User',
    headers: { 'Content-Type': 'application/json' },
    body: exampleUserDto,
  })
  @defineRequest({ body: CredentialsDto })
  public async create(req: Request) {
    const { body } = req;
    const user = DataStore.signUp(body as CredentialsDto);
    return {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: user,
    };
  }
  
  @patch('/user/:id', { tags: ['User'] })
  @withAuth(bearerAuth)
  @defineResponse({
    statusCode: 200,
    title: 'User',
    headers: { 'Content-Type': 'application/json' },
    body: exampleUserDto,
  })
  @defineRequest({ body: UserDto, path: Id })
  public async update(req: Request) {
    const isMyId = this.isMyId(req);
    if (!isMyId) {
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: { message: 'Access denied' },
      };
    }
    const { path, body } = req;
    const user = DataStore.getUser(path.id);
    if (user) {
      DataStore.setUser(path.id, body as UserDto);
    }
    return {
      statusCode: user ? 200 : 404,
      headers: { 'Content-Type': 'application/json' },
      body: DataStore.getUser(path.id) || { message: 'Not Found' },
    };
  }

  @post('/user/:id/avatar', { tags: ['User'] })
  @withAuth(bearerAuth)
  @defineResponse({
    statusCode: 200,
    title: 'User',
    headers: { 'Content-Type': 'application/json' },
    body: exampleUserDto,
  })
  @defineRequest({ path: Id, files: UserFilesDto })
  public setAvatar(req: Request) {
    const isMyId = this.isMyId(req);
    if (!isMyId) {
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: { message: 'Access denied' },
      };
    }
    const { path, files } = req;
    const user = DataStore.getUser(path.id);
    if (!user) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: { message: 'Not Found' },
      };
    }
    const { avatar } = files;
    const writeStream = createWriteStream(`${process.cwd()}/uploads/user-${path.id}-avatar.png`, {
      encoding: 'latin1',
    });
    avatar.stream.pipe(writeStream);
    return {
      statusCode: 202,
      headers: { 'Content-Type': 'application/json' },
      body: {},
    };
  }

}
```

---

## Use these decorators inside DTO classes:

### `fileUploadProperty`

```ts
fileUploadProperty(filePropertyDefinition: [FilePropertyDefinition](#filepropertydefinition))
```

#### Arguments
- **filePropertyDefinition**: Object describing file upload rules, including:
  - `mimetypes`: Array of allowed MIME types.
  - `maxSize`: Maximum file size (bytes).
  - `required`: Whether the file must be provided.
  - `mimetypeError`, `maxSizeError`, `requiredError`: Error objects describing validation failures.

#### `FilePropertyDefinition`

```ts
interface FilePropertyDefinition {
  mimetypes: string[];
  maxSize: number;
  required: boolean;
  mimetypeError: AladoServerError;
  maxSizeError: AladoServerError;
  requiredError: AladoServerError;
}
```

---

### `documentProperty`

```ts
documentProperty(propertyDocumentation: [PropertyDocumentation](#propertydocumentation))
```

#### Arguments
- **propertyDocumentation**: Documentation metadata for a property, including:
  - `schema`: JSON Schema–like definition (`type`, `format`, validation structure).
  - `description`: Human-readable explanation.
  - `example`: Example value.

#### `PropertyDocumentation`

```ts
interface PropertyDocumentation {
  schema: PropertyDefinitionSchema;
  description?: string;
  example?: any;
}
```

#### `PropertyDefinitionSchema`

```ts
interface PropertyDefinitionSchema {
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
}
```

---

### `validateProperty`

```ts
validateProperty(propertyValidation: [PropertyValidation](#propertyvalidation))
```

#### Arguments
- **propertyValidation**: Validation rules, including:
  - `required`: Whether the property is mandatory.
  - `handler`: Function to validate the property value (sync or async).
  - `error`: Error object returned when validation fails.

#### `PropertyValidation`

```ts
interface PropertyValidation {
  required?: boolean;
  handler: (value: any) => boolean | Promise<boolean>; // throws error when returns false
  error: AladoServerError;
}
```

---
DTOs examples:

```typescript
import { validateProperty, documentProperty } from 'alado';

export class Id {
  @validateProperty({
    required: true,
    handler: async (value: any) => idValidator(value),
    error: {
      statusCode: 400,
      message: 'Invalid id',
    },
  })
  @documentProperty({
    schema: {
      type: 'string',
    },
    example: '7ef5ed25-53b1-432f-96ec-8e35d830eb9c',
    description: 'User Id',
  })
  id: string = '7ef5ed25-53b1-432f-96ec-8e35d830eb9c';
}

```


```typescript
import { fileUploadProperty } from 'alado';

export class UserFilesDto {
  @fileUploadProperty({
    mimetypes: ['image/png'],
    maxSize: 1048576,
    required: true,
    maxSizeError: {
      statusCode: 413,
      message: 'The avatar should not be larger than 1MB',
    },
    mimetypeError: {
      statusCode: 415,
      message: 'The avatar should be a PNG image',
    },
    requiredError: {
      statusCode: 400,
      message: 'The avatar file is required',
    },
  })
  avatar: string = '/path/to/image.png';
}

```

```typescript
import { validateProperty, documentProperty } from 'alado';

export class CredentialsDto {
  @validateProperty({
    required: true,
    handler: async (value: any) => emailValidator(value),
    error: {
      statusCode: 400,
      message: 'Invalid email',
    },
  })
  @documentProperty({
    schema: {
      type: 'string',
    },
    example: 'example@example.com',
    description: 'User email',
  })
  email: string = 'example@example.com';

  @validateProperty({
    required: true,
    handler: async (value: any) => passwordValidator(value),
    error: {
      statusCode: 400,
      message: 'Invalid password',
    },
  })
  @documentProperty({
    schema: {
      type: 'string',
    },
    example: 'securePassword',
    description: 'User password',
  })
  password: string = 'securePassword';
}

export const credentialsDto = new CredentialsDto();

```

---

## Initialize the application

Finally, use the `initializeApplication` function to get an instance you would like to run:

```ts
import { initializeApplication } from 'alado';
import { aladoServerOptions } from '@config';
import { UserController } from '@user';

export const app = initializeApplication({
  serverOptions: aladoServerOptions,
  controllers: [UserController]
});

app.start(() => console.log('Application has been successfully started'));

```

#### Arguments
- **initializeApplicationOptions**: Object containing:
  - **serverOptions** ([AladoServerOptions](#aladoserveroptions)): Configuration for starting the server (e.g., `appId`, port, logger).
  - **controllers**: Array of controller classes to initialize at startup.

#### `InitializeApplicationOptions`

```ts
interface InitializeApplicationOptions {
  serverOptions: AladoServerOptions;
  controllers: AnyClass[];
}
```

#### `AladoServerOptions`

```ts
interface AladoServerOptions {
  appId?: string;
  port?: number;
  logger?: AladoServerLogger;
}
```

#### `AladoServerLogger`

```ts
interface AladoServerLogger {
  log: (...args: any[]) => void;
  error: (error: Error) => void;
}
```



There is an example of the API creating with Alado (version < 2.0.0):

The basis of use is a combination of interface simplicity and separation of the “routine” part of writing API
from business logic implementation - due to a declarative approach to describing all request parameters
in the form of static reusable structures.

[https://github.com/databikers/alado-api-example](https://github.com/databikers/alado-api-example)

1. Installation

```shell
npm i -s alado
```

2. Instancing

```typescript
import { AladoServer } from 'alado';

const app: AladoServer = new AladoServer({
  port: 3000,
  cors: {
    enable: true,
    allowedOrigin: '*',
    allowedHeaders: ['Authorization'],
    exposeHeaders: ['x-total-count'],
  },
  documentProperty: {
    enable: true,
    route: '/open-api',
    info: {
      title: 'My API title',
      description: 'My API description',
      version: '1.0.0',
    },
  },
  verbose: true,
  maxBodySizeBytes: 1024,
});
```

In case you want to run an HTTPs server (even though normally a Node.js app runs behind nginx/ingress etc.)
You can do it using the ssl parameter (look at SecureContextOptions in the "tls" module -
[Node.js TLS module](https://nodejs.org/api/tls.html#tlscreateserveroptions-secureconnectionlistener):

```typescript
import { readFileSync } from 'fs';
import { AladoServer } from 'alado';

const app = new AladoServer({
  port: 3000,
  ssl: {
    cert: readFileSync('/path/to/cert'),
    key: readFileSync('/path/to/key'),
  },
  // https://nodejs.org/api/http.html#httpcreateserveroptions-requestlistener
  serverOptions: {
    keepAliveTimeout: 5000,
  },
  cors: {
    enable: true,
    allowedOrigin: '*',
    allowedHeaders: ['Authorization'],
    exposeHeaders: ['x-total-count'],
    allowedCredentials: true,
    maxAge: 3600,
  },
  headers: {
    a: 'b', //any additional header
  },
  openApiDoc: {
    enable: true,
    route: '/',
    info: {
      title: 'My API title',
      description: 'My API description',
      version: '1.0.0',
    },
  },
  verbose: true,
  maxBodySizeBytes: 1024,
});
```

3. Defining routes

Here is how you define routes in Alado:

```typescript
app.get('/user/:id', context, (request: Request): Response<UserDto> => {
  const user = {
    name: 'John Doe',
    id: request.path.id,
  };
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
    },
    body: user,
  };
});

app.start(() => console.log(`[API]: application has been launched successfully`));
```

The application provides "get", "post", "delete", "patch", "put" and "head" methods for defining routes.
These methods accept three required arguments:

- route or path: A string that may contain variables to specify the route.
- context: An aggregating object that fully describes the request.
- handler: A function that handles the request.

  3.1 Route or path.

Path variables defining works in the same way as it works in other frameworks: You just define a part of your route (means part separated by slashes)
as ":id" and receive the passed value as request.path.id).

3.2 Context

Here's the contract of the request context:

```typescript
interface Context<T> {
  title: string;
  auth?: RequestAuthentication;
  isHidden?: boolean; //Just exclude some route from Your API specification
  options: ContextOptions;
  request: ContextRequest;
  response: Response<T>;
}
```

Unlike context.title, which is simply a unique string, the other properties may not be immediately clear.
However, once explained, they become quite obvious and extremely logical.

**Note that all parts of the context and its nested properties can be reused**

3.2.1 Context.auth

```typescript
import { RequestAuthentication } from 'alado';

const bearerAuth: RequestAuthentication = {
  inputProperty: 'headers.authorization',
  outputProperty: 'auth.user',
  handler: async (bearer: string) => {
    // validateProperty header, return user
    return {
      name: 'John Doe',
      id: 1,
    };
  },
  required: true, // false You want "soft" checking
  error: {
    statusCode: 401,
    message: 'Unauthorized',
  },
};
```

This means that the application takes an "Authorization" header
(or "api_token" query parameter if you provide "query.api_token" as an inputProperty,
"body.someThing" and "path.token" work also)
use the provided handler to get the user and set the received user to request.auth.user,
(and the mentioned "request" here is the request argument in your route handler)
Or just returns 401 Unauthorized.
This means that the application can authenticate using an "Authorization" header, or alternatively,
using an "api_token" query parameter (if specified as "query.api_token" in the inputProperty).
It can also authenticate using values like "body.someThing" or "path.token".
In the example the provided handler retrieves the user and assigns it to request.auth.user
(where request is the argument in your route handler).
If authentication fails, it returns a 401 Unauthorized response.

This also works:

```typescript
import { RequestAuthentication } from 'alado';

const bearerAuth: RequestAuthentication = {
  inputProperty: 'header.x-api-token',
  outputProperty: 'auth',
  handler: async (xApiToken: string) => {
    // You will receive user and company as nested properties in request auth
    return {
      user: {
        name: 'John Doe',
        id: 1,
      },
      company: {
        name: 'Databikers Limited',
        id: 2,
      },
    };
  },
  //optional property if You want to specify execution context for the auth handler
  handlerContext: {},
  required: true, // false You want "soft" checking
  error: {
    statusCode: 401,
    message: 'Unauthorized',
  },
};
```

3.2.2 Context.options

```typescript
interface ContextOptions {
  allowUnknownFields?: boolean;
  documentProperty?: {
    description?: string;
    operationId: string;
    tags?: string[];
  };
}
```

Setting "allowUnknownFields" to false protects your application from receiving unexpected properties in the request body, query, and files. It does not affect request.path, as path variables are defined at the routing level, nor does it affect request headers. Conversely, you can receive { name: 'John Doe', role: 'Admin' } when only expecting name.

The "documentProperty" property is part of the Open API route definition and is optional.

3.2.3 Context.request

Context.request is aggregating object that describes all HTTP request properties You expect

```typescript
interface ContextRequest {
  headers?: Record<string, PropertyDefinition>;
  query?: Record<string, PropertyDefinition>;
  path?: Record<string, PropertyDefinition>;
  body?: Record<string, PropertyDefinition>;
  files?: Record<string, FilePropertyDefinition>;
  auth?: Record<string, any>;
}
```

There's an example for request with path property only:

```typescript
const request: ContextRequest = {
  path: {
    id: {
      documentProperty: {
        schema: {
          type: 'string',
        },
        example: '123456',
        description: 'User id',
      },
      validation: {
        required: true,
        handler(value) {
          return /^\d+$/.test(value);
        },
        transform(value) {
          return parseInt(value, 10);
        },
        error: {
          statusCode: 400,
          message: '400.1.0',
        },
      },
    },
  },
};
```

Validation.handler returns boolean (any => boolean | any => Promise<boolean>) if received value fits to provided requirements,
and in falsy case it throws an error and app returns 400 Bad Request with a json body contains specified message
Handler can be async and can use complex logic under the hood; it allows to use
Avoid using an arrow functions as handlers - in this case You can lose execution context,
The execution context of validation.handler (and validation transform) is the request
(aggregating object - the argument used at the route handler)

```typescript
const request: ContextRequest = {
  body: {
    role: {
      documentProperty: {
        schema: {
          type: 'string',
        },
        example: 'admin',
        description: 'User role',
      },
      validation: {
        required: true,
        async handler(value) {
          if (this.auth.user.role === 'admin') {
            return true;
          }
          await userService.makeSomeChecking(this.query.scope);
          return value === 'customer';
        },
        error: {
          statusCode: 400,
          message: '400.1.0',
        },
      },
    },
  },
};
```

In the same way You can describe the request headers, query, body. Remember, if context.options.allowUnknownFields
is set to false, all non-described request properties (or non-described nested properties in the described request properties) never be accessible.

```typescript
const request: ContextRequest = {
  query: {
    sortBy: {
      documentProperty: {
        schema: {
          type: 'string',
        },
        example: 'createdAt',
        description: 'Sort by field',
      },
      validation: {
        required: true,
        handler(value) {
          return [
            'createdAt',
            'updatedAt',
          ].includes(value);
        },
        error: {
          statusCode: 400,
          message: 'sortBy should be createdAt or updatedAt',
        },
      },
    },
    sortOrder: {
      documentProperty: {
        schema: {
          type: 'string',
        },
        example: 'asc',
        description: 'Sort order',
      },
      validation: {
        required: true,
        handler(value) {
          return [
            'asc',
            'desc',
          ].includes(value);
        },
        error: {
          statusCode: 400,
          message: 'sortOrder should be asc or desc',
        },
      },
    },
  },
};
```

Now, if you send GET /user?sortBy=updateAt&sortOrder=desc&limit=10, the limit parameter will be ignored since it wasn't described:

```typescript
app.post('/user', context, (request: Request) => {
  console.log(request.query);

  // {
  //   sortBy: 'updatedAt',
  //   sortOrder: 'desc'
  // }

  console.log(request.ip);

  // 127.0.0.1

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
    },
    body: [],
  };
});
```

Regarding the request body even it described properly it will be available only for POST, PUT and PATCH HTTP requests.
If You want dealing with uploaded files You just should to describe it in the request:

```typescript
const request: ContextRequest = {
  files: {
    avatar: {
      mimetypes: ['image/png'],
      maxSize: 1048576,
      required: true,
      maxSizeError: {
        statusCode: 413,
        message: 'The avatar should not be larger than 1MB',
      },
      mimetypeError: {
        statusCode: 415,
        message: 'The avatar should be a PNG image',
      },
      requiredError: {
        statusCode: 400,
        message: 'The avatar file is required',
      },
    },
  },
};
```

and uploaded file will be acceptable in the request:

```typescript
import { createWriteStream } from 'fs';

app.post('/user/:id/avatar', context, (request: Request) => {
  console.log(request.files);
  // {
  //   avatar: {
  //     stream: Readable,
  //     size: 65025,
  //     mimetype: 'image/png'
  //   }
  // }

  // You can play with request.files.avatar.stream as You want e.g. save it locally

  const writeStream = createWriteStream(`/path/to/user/avatars/${req.path.id}.png`);
  request.files.avatar.stream.pipe(writeStream);
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
    },
    body: user,
  };
});
```

3.2.4 Context response

Context.response is always the same as the return type of the route handler

```typescript
interface Response<T> {
  title?: string;
  description?: string;
  statusCode: number;
  headers?: Record<string, string>;
  body?: T;
}
```

3.3 Route handler

The route handler is the function that implements the following contract:

```typescript
(request: Request) => Response<T> | Promise<Response<T>>;
```

Despite having a strict contract for the return type,
the response body can be an object (for application/json content-type), text, or even a stream

```typescript
interface UserDto {
  id: number;
  name: string;
}

const handlerWithJSONBody = (request: Request): Response<UserDto> => {
  const body: UserDto = {
    id: 1,
    name: 'John Doe',
  };
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body,
  };
};

const handlerWithStringBody = (request: Request): Response<string> => {
  const body: string = 'Not Found';
  return {
    statusCode: 404,
    headers: { 'Content-Type': 'text/plain' },
    body,
  };
};

const handlerWithStreamBody = (request: Request): Response<ReadStream> => {
  const body = createReadStream('/path/to/image.png');
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'image/png' },
    body,
  };
};
```

4. Running

```typescript
app.start(() => console.log('Your awesome application has been successfully launched'));

// And stop the application when needed
app.stop(() => console.log('Your awesome application has been successfully launched'));
```

Don't forget to check swagger at the defined above options.documentProperty.route
