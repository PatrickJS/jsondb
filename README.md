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

See [SPEC.md](./SPEC.md) for the full product model.
