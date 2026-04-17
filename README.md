# Alado

> A fast, lightweight, zero-dependency Node.js HTTP framework with built-in routing, validation, authentication, file uploads, and automatic OpenAPI 3.0 documentation.

[![npm](https://img.shields.io/npm/v/alado)](https://www.npmjs.com/package/alado)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

---

## Table of Contents

- [Why Alado](#why-alado)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [tsconfig Setup](#tsconfig-setup)
- [Application Setup](#application-setup)
- [Controllers](#controllers)
  - [HTTP Method Decorators](#http-method-decorators)
  - [defineRequest](#definerequest)
  - [defineResponse](#defineresponse)
  - [withAuth](#withauth)
- [DTOs](#dtos)
  - [validateProperty](#validateproperty)
  - [documentProperty](#documentproperty)
  - [transformProperty](#transformproperty)
  - [fileUploadProperty](#fileuploadproperty)
- [Authentication](#authentication)
- [File Uploads](#file-uploads)
- [OpenAPI / Swagger](#openapi--swagger)
- [API Reference](#api-reference)

---

## Why Alado

Alado sits in a unique position — it has the **simplicity of Express**, the **performance focus of Fastify**, and the **decorator-based structure of NestJS**, but with **zero external dependencies** and a much smaller surface area.

---

### Feature Comparison

| Feature                     | Alado      | Express               | Fastify               | NestJS      |
| --------------------------- | ---------- | --------------------- | --------------------- | ----------- |
| Zero dependencies           | ✅         | ❌                    | ❌                    | ❌          |
| Decorator-based routing     | ✅         | ❌                    | ❌                    | ✅          |
| Built-in request validation | ✅         | ❌                    | ✅ (schemas)          | ✅ (pipes)  |
| Built-in auth pipeline      | ✅         | ❌                    | ❌                    | ✅ (guards) |
| Auto OpenAPI 3.0 docs       | ✅         | ❌                    | ✅ (plugin)           | ✅ (plugin) |
| Built-in file upload        | ✅         | ❌                    | ❌                    | ❌          |
| Built-in body parsing       | ✅         | ❌ (body-parser)      | ✅                    | ✅          |
| Built-in CORS               | ✅         | ❌ (cors)             | ❌ (plugin)           | ✅          |
| TypeScript-first            | ✅         | ⚠️ types via `@types` | ⚠️ types via `@types` | ✅          |
| Learning curve              | 🟢 Low     | 🟢 Low                | 🟡 Medium             | 🔴 High     |
| Boilerplate                 | 🟢 Minimal | 🟡 Medium             | 🟡 Medium             | 🔴 Heavy    |
| Ecosystem / plugins         | 🟡 Small   | 🟢 Massive            | 🟢 Large              | 🟢 Large    |

---

## Installation

```bash
npm install alado
```

---

## Quick Start

A minimal API in under 30 lines:

```ts
// src/modules/user/user.controller.ts
import { post, defineRequest, defineResponse } from 'alado';
import { CredentialsDto } from './dto/credentials.dto';

export class UserController {
  @post('/user', { tags: ['User'] })
  @defineResponse({
    statusCode: 201,
    title: 'Created',
    headers: { 'Content-Type': 'application/json' },
    body: { id: '123', email: 'user@example.com' },
  })
  @defineRequest({ body: CredentialsDto })
  async create(req) {
    const user = { id: '123', ...req.body };
    return {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: user,
    };
  }
}
```

```ts
// src/main.ts
import { initializeApplication } from 'alado';
import { UserController } from './user/user.controller';

const app = initializeApplication({
  serverOptions: { port: 3000 },
  controllers: [UserController],
});

app.start(() => console.log('Running on http://localhost:3000'));
```

---

## Project Structure

Possible layout for a decorator-based Alado project:

```
src/
├── main.ts                     # App entry point
├── config/
│   └── server.options.ts       # AladoServerOptions
├── auth/
│   └── bearer.auth.ts          # RequestAuthentication config
└── modules/
    └── user/
        ├── index.ts
        ├── user.controller.ts
        └── dto/
            ├── credentials.dto.ts
            ├── user.dto.ts
            ├── user-files.dto.ts
            └── id.dto.ts
```

---

## Application Setup

### `initializeApplication`

```ts
import { initializeApplication } from 'alado';
import { UserController } from '@user';

const app = initializeApplication({
  serverOptions: {
    port: 3000,
    appId: 'my-api', // optional — used to scope multi-app setups
    logger: {
      log: console.log,
      error: console.error,
    },
  },
  controllers: [UserController],
});

app.start(() => console.log('Started'));
app.stop(() => console.log('Stopped'));
```

### Passing options to controller constructors

```ts
initializeApplication({
  serverOptions: { port: 3000 },
  controllers: [
    {
      controller: UserController,
      options: [{ service: UserService }], // passed to new UserController(...)
    },
  ],
});
```

### HTTPS

```ts
import { readFileSync } from 'fs';

const app = initializeApplication({
  serverOptions: {
    port: 443,
    ssl: {
      cert: readFileSync('/path/to/cert.pem'),
      key: readFileSync('/path/to/key.pem'),
    },
  },
  controllers: [UserController],
});
```

---

## Controllers

Controllers are plain TypeScript classes decorated with HTTP method decorators.

### HTTP Method Decorators

```ts
import { get, post, put, patch, del, head } from 'alado';
```

| Decorator                | Method |
| ------------------------ | ------ |
| `@get(path, options?)`   | GET    |
| `@post(path, options?)`  | POST   |
| `@put(path, options?)`   | PUT    |
| `@patch(path, options?)` | PATCH  |
| `@del(path, options?)`   | DELETE |
| `@head(path, options?)`  | HEAD   |

**Options:**

```ts
interface HttpDecoratorOptions {
  appId?: string; // scope to a specific app instance
  title?: string; // endpoint name in OpenAPI
  description?: string; // endpoint description in OpenAPI
  tags?: string[]; // grouping tags in OpenAPI
  isHidden?: boolean; // exclude from OpenAPI output
}
```

**Example:**

```ts
@get('/users', { tags: ['User'], title: 'List users' })
async list(req: Request) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: [],
  };
}
```

---

### `defineRequest`

Declares and validates the incoming request shape.

```ts
@defineRequest({
  headers: AnyClass,
  query:   AnyClass,
  path:    AnyClass,
  body:    AnyClass,
  files:   AnyClass,
  auth:    AnyClass,
})
```

Each value is a DTO class whose properties carry `@validateProperty`, `@documentProperty`, etc.

**Example:**

```ts
@post('/user', { tags: ['User'] })
@defineRequest({ body: CredentialsDto })
async create(req: Request) {
  console.log(req.body); // typed, validated CredentialsDto fields
}
```

---

### `defineResponse`

Documents the expected response shape for OpenAPI output.

```ts
@defineResponse({
  statusCode: 201,
  title: 'Created',
  entity: 'User',
  description: 'User was created successfully',
  headers: { 'Content-Type': 'application/json' },
  body: exampleUserDto,   // an instance of your DTO class
})
```

---

### `withAuth`

Attaches an authentication pipeline to a route.

```ts
@patch('/user/:id', { tags: ['User'] })
@withAuth(bearerAuth)
@defineRequest({ path: Id, body: UserDto })
async update(req: Request) {
  console.log(req.auth.user); // injected by the auth handler
}
```

See [Authentication](#authentication) for full config details.

---

### Full controller example

```ts
import { get, post, patch, del, defineRequest, defineResponse, withAuth } from 'alado';
import { bearerAuth } from './auth/bearer.auth';
import { CredentialsDto, UserDto, Id } from './dto';

export class UserController {
  @get('/users', { tags: ['User'] })
  @defineResponse({
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: [],
  })
  async list(req) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: [],
    };
  }

  @post('/user', { tags: ['User'] })
  @defineResponse({
    statusCode: 201,
    headers: { 'Content-Type': 'application/json' },
    body: {},
  })
  @defineRequest({ body: CredentialsDto })
  async create(req) {
    return {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: req.body,
    };
  }

  @patch('/user/:id', { tags: ['User'] })
  @withAuth(bearerAuth)
  @defineResponse({
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: {},
  })
  @defineRequest({
    path: Id,
    body: UserDto,
  })
  async update(req) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: req.body,
    };
  }

  @del('/user/:id', { tags: ['User'] })
  @withAuth(bearerAuth)
  @defineRequest({ path: Id })
  async remove(req) {
    return {
      statusCode: 204,
      headers: {},
      body: null,
    };
  }
}
```

---

## DTOs

DTOs are plain TypeScript classes with decorated properties. They define how request data is validated, transformed, and documented.

### `validateProperty`

Validates an incoming property value. Runs before your handler.

```ts
import { validateProperty } from 'alado';

class CredentialsDto {
  @validateProperty({
    required: true,
    handler: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    error: {
      statusCode: 400,
      message: 'Invalid email address',
    },
  })
  email: string = 'user@example.com';
}
```

- `handler` receives the raw value and must return `boolean | Promise<boolean>`
- returning `false` → framework returns the configured `error` automatically
- `handler` is called with `this` bound to the full `Request` object — you can access `this.auth`, `this.query`, etc.
- **do not use arrow functions** if you need access to `this`

---

### `documentProperty`

Adds OpenAPI/Swagger metadata to a property.

```ts
import { documentProperty } from 'alado';

class UserDto {
  @documentProperty({
    schema: {
      type: 'string',
      minLength: 2,
      maxLength: 50,
    },
    description: 'The user display name',
    example: 'John Doe',
  })
  name: string = 'John Doe';
}
```

Supports the full OpenAPI `PropertyDefinitionSchema`:

```ts
interface PropertyDefinitionSchema {
  type?: string; // 'string' | 'number' | 'boolean' | 'object' | 'array'
  format?: string; // 'email' | 'uuid' | 'date-time' | ...
  default?: any;
  nullable?: boolean;
  enum?: any[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  items?: PropertyDefinitionSchema; // for arrays
  properties?: Record<string, PropertyDefinitionSchema>; // for objects
  oneOf?: PropertyDefinitionSchema[];
  anyOf?: PropertyDefinitionSchema[];
  allOf?: PropertyDefinitionSchema[];
}
```

---

### `transformProperty`

Transforms a property value before it reaches your handler.

```ts
import { transformProperty } from 'alado';

class QueryDto {
  @transformProperty((value) => parseInt(value.toString(), 10))
  page: number = 1;

  @transformProperty((value) => value.trim().toLowerCase())
  email: string = '';
}
```

---

### `fileUploadProperty`

Marks a DTO property as a file upload field with MIME type and size validation.

```ts
import { fileUploadProperty } from 'alado';

export class UserFilesDto {
  @fileUploadProperty({
    mimetypes: [
      'image/png',
      'image/jpeg',
    ],
    maxSize: 2 * 1024 * 1024, // 2MB in bytes
    required: true,
    maxSizeError: {
      statusCode: 413,
      message: 'File must not exceed 2MB',
    },
    mimetypeError: {
      statusCode: 415,
      message: 'Only PNG and JPEG images are allowed',
    },
    requiredError: {
      statusCode: 400,
      message: 'Avatar file is required',
    },
  })
  avatar: string = '/path/to/avatar.png';
}
```

---

### Combining decorators

Decorators stack — use them together for full validation + documentation:

```ts
export class Id {
  @validateProperty({
    required: true,
    handler: (value) => /^[0-9a-f-]{36}$/.test(value),
    error: {
      statusCode: 400,
      message: 'Invalid UUID',
    },
  })
  @documentProperty({
    schema: {
      type: 'string',
      format: 'uuid',
    },
    example: '7ef5ed25-53b1-432f-96ec-8e35d830eb9c',
    description: 'Resource identifier',
  })
  id: string = '7ef5ed25-53b1-432f-96ec-8e35d830eb9c';
}
```

---

## Authentication

Define a `RequestAuthentication` config object and pass it to `@withAuth`.

```ts
// src/modules/user/auth/bearer.auth.ts
import { RequestAuthentication } from 'alado';
import { DataStore } from '@data-store';

export const bearerAuth: RequestAuthentication = {
  required: true,
  inputProperty: 'headers.x-api-key', // where to read the token from
  outputProperty: 'auth.user', // where to write the result on req
  handler(value: string) {
    return DataStore.findUserByToken(value); // return user or null/undefined
  },
  error: {
    statusCode: 401,
    message: 'Unauthorized',
  },
};
```

The `inputProperty` supports dot-notation and can point to any part of the request:

| `inputProperty`         | Reads from           |
| ----------------------- | -------------------- |
| `headers.x-api-key`     | Request header       |
| `headers.authorization` | Authorization header |
| `query.api_token`       | Query parameter      |
| `body.token`            | Request body field   |
| `path.token`            | Path parameter       |

The resolved value from `handler` is set at `outputProperty` on the request object, making it available as `req.auth.user` in your handler.

**Optional auth** — set `required: false` for soft checking (handler runs but failure doesn't block the request):

```ts
export const optionalAuth: RequestAuthentication = {
  required: false, // won't return 401 if token is missing or invalid
  inputProperty: 'headers.authorization',
  outputProperty: 'auth.user',
  handler: (token) => UserService.findByToken(token),
  error: {
    statusCode: 401,
    message: 'Unauthorized',
  },
};
```

---

## File Uploads

1. Define a files DTO:

```ts
// src/modules/user/dto/user-files.dto.ts
import { fileUploadProperty } from 'alado';

export class UserFilesDto {
  @fileUploadProperty({
    mimetypes: ['image/png'],
    maxSize: 1048576, // 1MB
    required: true,
    maxSizeError: {
      statusCode: 413,
      message: 'Max size is 1MB',
    },
    mimetypeError: {
      statusCode: 415,
      message: 'Only PNG allowed',
    },
    requiredError: {
      statusCode: 400,
      message: 'File is required',
    },
  })
  avatar: string = '';
}
```

2. Use in controller:

```ts
import { createWriteStream } from 'fs';

@post('/user/:id/avatar', { tags: ['User'] })
@withAuth(bearerAuth)
@defineRequest({ path: Id, files: UserFilesDto })
setAvatar(req) {
  const { avatar } = req.files;
  // avatar = { stream: Readable, size: number, mimetype: string }

  const writeStream = createWriteStream(`./uploads/user-${req.path.id}.png`);
  avatar.stream.pipe(writeStream);

  return {
    statusCode: 202,
    headers: { 'Content-Type': 'application/json' },
    body: { message: 'Upload accepted' },
  };
}
```

---

## OpenAPI / Swagger

Alado generates OpenAPI 3.0 documentation automatically from your decorators. No extra config needed — just enable it in server options:

```ts
const app = initializeApplication({
  serverOptions: {
    port: 3000,
    openApiDoc: {
      enable: true,
      route: '/', // serve Swagger UI at this path
      info: {
        title: 'My API',
        description: 'Auto-generated with Alado',
        version: '1.0.0',
      },
    },
  },
  controllers: [UserController],
});
```

Open `http://localhost:3000/` to view the Swagger UI.

Documentation is built from:

- `@get`, `@post`, etc. → endpoint paths and methods
- `tags`, `title`, `description` in decorator options → grouping and descriptions
- `@defineRequest` + DTO `@documentProperty` → request schema
- `@defineResponse` → response schema
- `isHidden: true` → excludes endpoint from docs

---

## API Reference

### `initializeApplication(options)`

| Property        | Type                               | Description                    |
| --------------- | ---------------------------------- | ------------------------------ |
| `serverOptions` | `AladoServerOptions`               | Server configuration           |
| `controllers`   | `AnyClass[] \| ControllerConfig[]` | Controller classes to register |

### `AladoServerOptions`

| Property | Type                   | Default | Description                         |
| -------- | ---------------------- | ------- | ----------------------------------- |
| `port`   | `number`               | `3000`  | HTTP port                           |
| `appId`  | `string`               | —       | App identifier for multi-app setups |
| `logger` | `AladoServerLogger`    | —       | Custom logger                       |
| `ssl`    | `SecureContextOptions` | —       | TLS/HTTPS options                   |

### `Request`

The object received in every route handler:

| Property  | Type                         | Description                        |
| --------- | ---------------------------- | ---------------------------------- |
| `request` | `IncomingMessage`            | Raw Node.js request                |
| `ip`      | `string`                     | Client IP address                  |
| `method`  | `string`                     | HTTP method                        |
| `url`     | `string`                     | Request URL                        |
| `headers` | `IncomingHttpHeaders`        | Request headers                    |
| `path`    | `Record<string, string>`     | Path parameters                    |
| `query`   | `Record<string, any>`        | Query parameters                   |
| `body`    | `Record<string, any>`        | Request body (POST/PUT/PATCH only) |
| `rawBody` | `string`                     | Unparsed body string               |
| `files`   | `Record<string, FileResult>` | Uploaded files                     |
| `auth`    | `Record<string, any>`        | Auth handler output                |

### `Response<T>`

The object your handler must return:

| Property     | Type                     | Required | Description                                     |
| ------------ | ------------------------ | -------- | ----------------------------------------------- |
| `statusCode` | `number`                 | required | HTTP status code                                |
| `headers`    | `Record<string, string>` | —        | Response headers                                |
| `body`       | `T`                      | —        | Response body — object, string, or `ReadStream` |

---

## License

MIT © [Databikers Limited](https://databikers.com)
