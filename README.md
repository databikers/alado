Alado is an extremely fast, simple, robust, and lightweight (no-dependency)
for creating server applications written in Node.js and running over the HTTP protocol.

Its main difference from most similar well-known frameworks is that with a minimum of external dependencies
it provides out-of-the-box such fully-functioning features as routing, CORS, automatic API documentation (Open API 3.0),
parsing query and path parameters, and the request body, file uploading, request authentication, etc.

The basis of use is a combination of interface simplicity and separation of the “routine” part of writing API
from business logic implementation - due to a declarative approach to describing all request parameters
in the form of static reusable structures.

There is an example of the API creating with Alado:

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
  documentProperty: {
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
