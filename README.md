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

See [SPEC.md](./SPEC.md) for the full product model.
