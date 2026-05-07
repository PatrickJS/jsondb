# json-fixture-db

A local JSON fixture database for app development and tests. It can infer schema from fixture data, load schema-first fixtures, generate TypeScript types, and maintain a writable runtime mirror in `.jsondb/state`.

## Quick Start

```bash
mkdir -p db
cat > db/users.json <<'JSON'
[
  {
    "id": "u_1",
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "role": "admin"
  }
]
JSON

npx json-fixture-db sync
```

Generated files:

```txt
.jsondb/schema.generated.json
.jsondb/types/index.ts
.jsondb/state/users.json
```

## Schema-First Fixtures

```jsonc
{
  // Users who can sign into the local test app.
  "kind": "collection",
  "idField": "id",
  "fields": {
    "id": {
      "type": "string",
      "required": true,
      "description": "Stable user id."
    },
    "role": {
      "type": "enum",
      "values": ["admin", "user"],
      "default": "user",
      "description": "Local authorization role."
    }
  },
  "seed": []
}
```

You can also author executable schema files with `.schema.mjs`:

```js
import { collection, field } from 'json-fixture-db/schema';

export default collection({
  idField: 'id',
  fields: {
    id: field.string({ required: true }),
    role: field.enum(['admin', 'user'], { default: 'user' }),
  },
  seed: [],
});
```

Schema-backed fixtures are validated against declared field types. Required fields, primitive types, enum values, arrays, and nested objects are checked during `sync` and during package, REST, and GraphQL writes.

## CLI

```bash
jsondb sync
jsondb types
jsondb types --watch
jsondb types --out ./src/generated/jsondb.types.ts
jsondb schema
jsondb schema users
jsondb schema validate
jsondb create users '{"id":"u_2","name":"Grace Hopper"}'
jsondb serve
```

Run all repo examples and open an index of their viewers:

```bash
npm run examples
```

The examples index starts each example on its own port and lists links to each `/__jsondb` viewer.

Open the built-in viewer after starting the server:

```txt
http://127.0.0.1:7331/__jsondb
```

The viewer includes:

- resource and data browsing
- REST specs with copyable examples
- a REST request runner
- GraphQL SDL, query examples, and mutation examples
- a GraphQL runner with variables
- schema and field inspection

## REST And GraphQL

`jsondb serve` exposes REST routes for collections and singleton documents:

```txt
GET     /users
GET     /users/:id
POST    /users
PATCH   /users/:id
DELETE  /users/:id

GET     /settings
PUT     /settings
PATCH   /settings
```

It also exposes a dependency-free GraphQL subset at `/graphql`.

```graphql
query GetUser($id: ID!) {
  allUsers: users {
    id
    displayName: name
  }
  ada: user(id: $id) {
    email
  }
}
```

Multiple root fields and aliases in one request are supported:

```ts
const result = await client.graphql(`{
  users {
    id
    email
  }
  secondUsers: users {
    id
    email
  }
}`);
```

Supported GraphQL features include:

- queries and mutations
- root and nested field aliases
- variables
- object/list/scalar input values
- collection fields like `users` and `user(id: ID!)`
- collection mutations like `createUser`, `updateUser`, and `deleteUser`
- document fields like `settings`
- document mutations like `updateSettings` and `setSettings`

This is intentionally a focused GraphQL-compatible subset, not a general GraphQL engine. Fragments, directives, subscriptions, and full introspection are not implemented.

GraphQL batching is supported by posting an array to `/graphql`:

```json
[
  {
    "query": "{ users { id name } }"
  },
  {
    "query": "{ settings { theme } }"
  }
]
```

The client can also batch requests made within a short timeout. The default batching window is `10ms`. Identical REST `GET` and GraphQL `query` requests are deduped by default, while writes and GraphQL mutations are not deduped unless you explicitly choose `dedupe: 'all'`:

```ts
const client = createJsonDbClient({
  baseUrl: 'http://127.0.0.1:7331',
  batching: true,
});

const [first, second] = await Promise.all([
  client.graphql(`{ users { id email } }`),
  client.graphql(`{ users { id email } }`),
]);
```

REST batching is supported through:

```txt
POST /__jsondb/batch
```

```json
[
  {
    "method": "GET",
    "path": "/users"
  },
  {
    "method": "PATCH",
    "path": "/settings",
    "body": {
      "theme": "dark"
    }
  }
]
```

REST batches execute sequentially and are intentionally non-transactional. If an earlier write succeeds and a later batch item fails, the earlier write stays committed.

REST examples:

```ts
await client.rest.get('/users');

await client.rest.post('/users', {
  id: 'u_2',
  name: 'Grace Hopper',
  email: 'grace@example.com',
});

await client.rest.patch('/users/u_2', {
  role: 'admin',
});

await client.rest.delete('/users/u_2');
```

REST automatic batching uses the same `batching` option:

```ts
const [users, settings] = await Promise.all([
  client.rest.get('/users'),
  client.rest.get('/settings'),
]);
```

Mock latency and random errors can be enabled for local chaos testing:

```js
export default {
  mock: {
    delay: {
      minMs: 50,
      maxMs: 300,
    },
    errors: {
      rate: 0.05,
      status: 503,
      message: 'Random local mock failure',
    },
  },
};
```

The local server rejects oversized JSON bodies before buffering too much data. The default limit is `1048576` bytes and can be changed for local development:

```js
export default {
  server: {
    maxBodyBytes: 1048576,
  },
};
```

Errors are shaped to be readable by humans and useful to AI agents. REST/server errors use:

```json
{
  "error": {
    "code": "REST_BATCH_INVALID_PATH",
    "message": "REST batch path must start with \"/\": users",
    "hint": "Use absolute local paths such as \"/users\", \"/settings\", or \"/__jsondb/schema\".",
    "details": {
      "path": "users"
    }
  }
}
```

GraphQL errors use standard `errors[]` entries with `extensions`:

```json
{
  "data": null,
  "errors": [
    {
      "message": "Unknown GraphQL query field \"nope\".",
      "extensions": {
        "code": "GRAPHQL_UNKNOWN_QUERY_FIELD",
        "hint": "Use one of: \"users\", \"user\".",
        "details": {
          "field": "nope"
        }
      }
    }
  ]
}
```

The delay can also be written as a range:

```js
export default {
  mock: {
    delay: [50, 300],
    errors: 0.05,
  },
};
```

## Package API

```ts
import { openJsonFixtureDb } from 'json-fixture-db';
import type { JsonDbTypes } from './generated/jsondb.types';

const db = await openJsonFixtureDb<JsonDbTypes>({
  sourceDir: './db',
  stateDir: './.jsondb',
  mode: 'mirror',
});

const users = db.collection('users');
await users.create({
  id: 'u_2',
  name: 'Grace Hopper',
  email: 'grace@example.com',
  role: 'user',
});
```

You can also execute GraphQL directly through the package API:

```ts
import { executeGraphql, openJsonFixtureDb } from 'json-fixture-db';

const db = await openJsonFixtureDb({ sourceDir: './db' });
const result = await executeGraphql(db, {
  query: `{
    users {
      id
      email
    }
  }`,
});
```

Or use the small HTTP client:

```ts
import { createJsonDbClient } from 'json-fixture-db/client';

const client = createJsonDbClient({
  baseUrl: 'http://127.0.0.1:7331',
  batching: {
    enabled: true,
    delayMs: 10,
    dedupe: 'reads',
  },
});

const users = await client.graphql(`{
  users {
    id
    email
  }
}`);

const batch = await client.rest.batch([
  { method: 'GET', path: '/users' },
  { method: 'GET', path: '/settings' },
]);
```

See [SPEC.md](./SPEC.md) for the full product model.
