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
- [Application Setup](#application-setup)
- [Controllers](#controllers)
  - [HTTP Method Decorators](#http-method-decorators)
  - [defineRequest](#definerequest)
  - [defineResponse](#defineresponse)
  - [withAuth](#withauth)
  - [accessControl](#acesscontrol)
- [DTOs](#dtos)
  - [validateProperty](#validateproperty)
  - [validation](#validation)
  - [documentProperty](#documentproperty)
  - [transformProperty](#transformproperty)
  - [fileUploadProperty](#fileuploadproperty)
- [Authentication](#authentication)
- [Access Control](#accesscontrol)
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
| Built-in access control     | ✅         | ❌                    | ❌                    | ✅ (guards) |
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

## Example API: https://github.com/databikers/alado-decorators-api-example

## Project Structure

Possible layout for a decorator-based Alado project:

```
src/
├── main.ts                     # App entry point
├── config/
│   └── server.options.ts       # AladoServerOptions
├── auth/
│   └── bearer.auth.ts          # RequestAuthentication config
├── access-control/
│   └── access-control.ts       # AccessControl decorator & types
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
import { get, query, post, put, patch, del, head } from 'alado';
```

| Decorator                | Method |
| ------------------------ | ------ |
| `@get(path, options?)`   | GET    |
| `@query(path, options?)` | QUERY  |
| `@post(path, options?)`  | POST   |
| `@put(path, options?)`   | PUT    |
| `@patch(path, options?)` | PATCH  |
| `@del(path, options?)`   | DELETE |
| `@head(path, options?)`  | HEAD   |

**Options:**

```ts
type HttpDecoratorOptions = {
  appId?: string;
  title?: string;
  description?: string;
  isHidden?: boolean | undefined;
  tags?: string[];
};
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

### `accessControl`

Attaches an access control pipeline to a route.

```ts
@patch('/user/:id', { tags: ['User'] })
@accessControl([
  {
    inputProperty: 'auth.user.id',
    transformInputProperty: async (v: unknown) => v.toString(),
    compareWithProperty: 'path.id',
    statusCode: 403,
    message: 'Access Denied',
  },
])
@withAuth(bearerAuth)
@defineRequest({ path: Id, body: UserDto })
async update(req: Request) {
  console.log(req.auth.user); // injected by the auth handler
}
```

See [Access Control](#accesscontrol) for full config details.

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

## Validation

The project uses a built-in chainable validator — a lightweight, zero-dependency TypeScript validation library with sync and async support.

### Basic usage

```ts
import { validate } from 'alado';

const isEmail = validate.string().email().required().build();
const isUsername = validate
  .string()
  .min(3)
  .max(20)
  .regex(/^[a-z0-9_]+$/)
  .build();
const isRole = validate.string().enum('admin', 'user', 'guest').required().build();
const isAge = validate.number().integer().min(18).max(120).required().build();
const isId = validate.string().objectId().required().build();
```

Each chain ends with `.build()` which returns `(input: any) => Promise<boolean>` — build once, reuse anywhere. For sync-only rules use `.buildSync()` to get a plain `boolean`.

---

### Entry points

```ts
validate.string(); // starts a string validator
validate.number(); // starts a number validator
validate.boolean(); // starts a boolean validator
validate.array(); // starts an array validator
validate.object(); // starts an object validator
validate.custom(fn); // starts with a custom rule
```

---

### Modifiers

| Method        | Description                                                |
| ------------- | ---------------------------------------------------------- |
| `.required()` | Input must be non-empty (not `null`, `undefined`, or `""`) |
| `.optional()` | Input may be absent — skips all rules if empty (default)   |

---

### Available rules

**Type**

| Method      | Description                                  |
| ----------- | -------------------------------------------- |
| `string()`  | Must be a string                             |
| `number()`  | Must be a number (not NaN)                   |
| `boolean()` | Must be a boolean                            |
| `array()`   | Must be an array                             |
| `object()`  | Must be a plain object (not array, not null) |

**String**

| Method           | Description                               |
| ---------------- | ----------------------------------------- |
| `min(n)`         | Min length (string) or min value (number) |
| `max(n)`         | Max length (string) or max value (number) |
| `length(n)`      | Exact length                              |
| `regex(pattern)` | Must match RegExp                         |
| `email()`        | Valid email format                        |
| `uuid()`         | Valid UUID v4                             |
| `objectId()`     | Valid MongoDB ObjectId (24-char hex)      |
| `url()`          | Valid URL (parsed by `new URL()`)         |
| `trim()`         | No leading/trailing whitespace            |

**Number**

| Method       | Description        |
| ------------ | ------------------ |
| `integer()`  | Must be an integer |
| `positive()` | Must be `> 0`      |
| `negative()` | Must be `< 0`      |

**Generic**

| Method            | Description                                                  |
| ----------------- | ------------------------------------------------------------ |
| `enum(...values)` | Must be one of the provided values                           |
| `custom(fn)`      | Any custom `(value) => boolean \| Promise<boolean>` function |

**Object**

| Method          | Description                                                         |
| --------------- | ------------------------------------------------------------------- |
| `shape(schema)` | Validate each key against a nested validator                        |
| `minKeys(n)`    | Object must have at least `n` keys                                  |
| `maxKeys(n)`    | Object must have at most `n` keys                                   |
| `or(...keys)`   | At least one of the listed keys must be present and non-empty       |
| `xor(...keys)`  | Exactly one of the listed keys must be present (mutually exclusive) |

**Array**

| Method        | Description                           |
| ------------- | ------------------------------------- |
| `items(fn)`   | Every element must pass the validator |
| `minItems(n)` | Minimum array length                  |
| `maxItems(n)` | Maximum array length                  |
| `unique()`    | No duplicate values                   |

---

### Object shape

```ts
const isAddress = validate
  .object()
  .shape({
    street: validate.string().min(2).required().build(),
    city: validate.string().min(2).required().build(),
    country: validate.string().length(2).required().build(),
    zip: validate
      .string()
      .regex(/^\d{4,10}$/)
      .build(),
  })
  .required()
  .build();
```

Shapes can be nested to any depth:

```ts
const isUser = validate
  .object()
  .shape({
    id: validate.string().objectId().required().build(),
    email: validate.string().email().required().build(),
    role: validate.string().enum('admin', 'user').required().build(),
    address: validate
      .object()
      .shape({
        city: validate.string().required().build(),
        country: validate.string().length(2).required().build(),
      })
      .build(),
  })
  .required()
  .build();
```

---

### Object key constraints and mutual exclusion

```ts
// at least one contact method required
const isContact = validate.object().or('email', 'phone').build();

// exactly one payment method
const isPayment = validate.object().xor('cardId', 'bankAccount').build();

// bounded key count
const isMeta = validate.object().minKeys(1).maxKeys(10).build();
```

---

### Cross-property conditionals

Rules that look at sibling fields. The `root` context is passed automatically through `.shape()`.

#### `.when(key, is, then, otherwise?)`

If `root[key] === is`, apply `then` validator; otherwise apply `otherwise` (optional). `is` can be a single value or an array of values.

```ts
const isContact = validate
  .object()
  .shape({
    type: validate.string().required().build(),
    contact: validate
      .string()
      .when(
        'type',
        'email',
        validate.string().email().build(), // when type === 'email'
        validate
          .string()
          .regex(/^\+\d+$/)
          .build(), // otherwise (phone)
      )
      .required()
      .build(),
  })
  .build();

await isContact({ type: 'email', contact: 'a@b.com' }); // true
await isContact({ type: 'phone', contact: '+123456' }); // true
await isContact({ type: 'email', contact: '+123456' }); // false
```

Array `is` — match multiple values:

```ts
validate
  .string()
  .when(
    'role',
    [
      'admin',
      'superadmin',
    ],
    allowedFn,
    restrictedFn,
  )
  .build();
```

#### `.match(key, cases, fallback?)`

Switch-case style — dispatch to different validators based on `root[key]`.

```ts
const isLevel = validate
  .object()
  .shape({
    role: validate.string().required().build(),
    level: validate
      .number()
      .match(
        'role',
        {
          admin: validate.number().min(5).build(),
          viewer: validate.number().max(2).build(),
          editor: validate.number().min(1).max(4).build(),
        },
        validate.number().positive().build(),
      ) // fallback
      .required()
      .build(),
  })
  .build();

await isLevel({ role: 'admin', level: 7 }); // true
await isLevel({ role: 'viewer', level: 3 }); // false — max 2
```

---

### Array items

```ts
const isTagList = validate
  .array()
  .items(validate.string().min(1).max(30).required().build())
  .minItems(1)
  .maxItems(10)
  .unique()
  .required()
  .build();

const isOrderItems = validate
  .array()
  .items(
    validate
      .object()
      .shape({
        productId: validate.string().objectId().required().build(),
        quantity: validate.number().integer().positive().required().build(),
        price: validate.number().positive().required().build(),
      })
      .required()
      .build(),
  )
  .minItems(1)
  .required()
  .build();
```

---

### Async validation

Any rule can return `Promise<boolean>`. Use `.custom()` for async rules.

```ts
const isAvailableEmail = validate
  .string()
  .email()
  .required()
  .custom(async (v) => {
    const taken = await db.users.exists({ email: v });
    return !taken;
  })
  .build();

const ok = await isAvailableEmail('new@example.com');
```

Rules run sequentially — cheap sync checks short-circuit before any async I/O fires. Inside `.shape()` and `.items()`, field validators run in parallel via `Promise.all`.

---

### Sync mode

If you have no async rules, use `.buildSync()` to get a plain `boolean` without `await`.

```ts
const isValidName = validate.string().min(2).max(50).buildSync();

isValidName('Pablo'); // true — no await needed
```

`.buildSync()` throws at runtime if any rule in the chain is async:

```
Error: Validator contains async rules — use .build() instead of .buildSync()
```

---

### Use with Alado `@validateProperty`

```ts
import { documentProperty, validateProperty, validate } from 'alado';

export class CredentialsDto {
  @validateProperty({
    required: true,
    handler: validate.string().email().required().build(),
    error: { statusCode: 400, message: 'Invalid email' },
  })
  @documentProperty({
    schema: { type: 'string', format: 'email' },
    example: 'user@example.com',
  })
  email: string = '';

  @validateProperty({
    required: true,
    handler: validate.string().min(8).required().build(),
    error: { statusCode: 400, message: 'Password must be at least 8 characters' },
  })
  @documentProperty({
    schema: { type: 'string', minLength: 8 },
    example: 'securePassword',
  })
  password: string = '';
}
```

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

## Access Control

The `@accessControl` decorator provides a flexible and intuitive way to implement permission checking on your route handlers. It allows you to validate that requests meet specific authorization requirements by comparing values from the incoming request against expected values.

### Configuration

```typescript
export type AccessControlConfig<T> = {
  /**
   * The property path to extract from the request.
   * Examples: 'auth.user.id'
   */
  inputProperty: string;

  /**
   * Optional transformation function to process the extracted value.
   * Useful for normalizing or converting data types before comparison.
   */
  transformInputProperty?: (inputPropertyValue: unknown) => T | Promise<T>;

  /**
   * Property path to compare against in the request.
   * Examples: 'path.id' (URL parameter), 'body.user.id' (request body)
   */
  compareWithProperty?: string;

  /**
   * The expected value to compare against.
   * Use this if you have a fixed value rather than a dynamic property path.
   */
  expectedValue?: T;

  /**
   * Custom access control handler for complex permission logic.
   * Receives the extracted input value and should return true if access is granted.
   */
  accessControlHandler?: (inputPropertyValue: unknown) => Promise<boolean>;

  /**
   * HTTP status code to return when access is denied.
   * Commonly 403 (Forbidden) or 401 (Unauthorized).
   */
  statusCode: number;

  /**
   * User-friendly error message displayed when access is denied.
   */
  message: string;
};
```

Either provide `compareWithProperty` to compare two request values, or `expectedValue` to check against a fixed value or `accessControlHandler` to implement complex logic.

### Usage Example

```typescript
@patch('/user/:id', { tags: ['User'] })
@accessControl([{
  inputProperty: 'auth.user.id',
  transformInputProperty: async (v: unknown) => v.toString(),
  compareWithProperty: 'path.id',
  statusCode: 403,
  message: 'Access Denied'
}])
@withAuth(bearerAuth)
public async update(req: Request) {
  // Only allow users to update their own profile
  const { path, body } = req;
  const user = DataStore.getUser(path.id);
  if (user) {
    DataStore.setUser(path.id, body as UserDto);
  }
  return { statusCode: user ? 200 : 404, body: user || { message: 'Not Found' } };
}
```

In this example, the decorator ensures `auth.user.id` matches `path.id` before the handler executes. If access is denied, a 403 response is returned.

### Multiple Rules

Pass multiple configs to `@accessControl([...])` to enforce multiple access rules - all must pass for the request to proceed.

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

3. Respond with Stream:

```ts
@get('/user/:id/avatar', { tags: ['User'] })
@withAuth(bearerAuth)
@defineResponse({
  statusCode: 200,
  title: 'OK',
  headers: { 'Content-Type': 'image/png' },
  body: {},
})
@defineRequest({ path: Id })
public getAvatar(req: Request) {
  const readStream = createReadStream(`./uploads/user-${req.path.id}.png`);
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'image/png' },
    body: readStream,
  };
}
```

## XML Request Body (>=2.6.0)

When a request arrives with a `Content-Type` of `text/xml` or `application/xml`, Alado automatically parses the raw body into a plain JavaScript object before your handler runs — no configuration needed, and no external XML library involved. `req.body` behaves the same way it does for JSON requests.

### How the conversion works

- **Elements become object keys.** Each XML tag becomes a key in the resulting object, with its children nested underneath.
- **Repeated sibling tags collapse into an array.** `<item>a</item><item>b</item>` becomes `item: ['a', 'b']` rather than overwriting the key.
- **Leaf elements become plain strings.** `<name>Daniel</name>` becomes `name: 'Daniel'` — no wrapper object, no type coercion (numeric-looking text like `"10000.00"` is kept exactly as written, since silently converting it to a JS number would lose precision on monetary values).
- **Attributes are namespaced under `@attrs`.** An element like `<amount currency="USD">100</amount>` becomes `{ '@attrs': { currency: 'USD' }, '#text': '100' }`, keeping attribute data separate from element data and text content.
- **CDATA sections are unwrapped automatically**, and their contents treated as plain text.
- **Namespaces resolve to local names.** For SOAP envelopes or ISO 20022 style payment messages, elements are keyed by their local name regardless of which prefix the sender used (`soapenv:Body` and `soap:Body` parse identically if they share a namespace). Each element also carries an `@ns` field with its resolved namespace URI, so elements sharing a local name across different namespaces stay distinguishable.

Because the contract is identical to JSON, everything documented under [`defineRequest`](#definerequest) and [DTOs](#dtos) — `@validateProperty`, `@documentProperty`, `@transformProperty`, auto-generated OpenAPI schemas applies to XML bodies without any extra setup.

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

MIT © [Data Bikers Limited](https://databikers.com)
