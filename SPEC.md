# JSON Fixture DB Spec

## Schema And Type Generation

The `db/` folder can contain fixture data, schema/type definitions, or both.

```txt
db/
  users.json                 optional seed data
  posts.json                 optional seed data
  settings.json              optional singleton data

  users.schema.json          optional schema/type source (strict JSON)
  users.schema.jsonc         optional schema/type source (JSON with comments)
  posts.schema.jsonc
  settings.schema.jsonc

.jsondb/
  state/
  wal/
  migrations/
  schema.generated.json
  types/
    index.ts                 generated TypeScript types
```

Projects can also opt into committed generated types:

```txt
src/generated/
  jsondb.types.ts            committed generated types
```

## Developer Workflows

Developers can choose among data-first fixtures, schema/type-first fixtures, or mixed mode.

### Data-First Fixtures

The simplest path is a JSON fixture:

```txt
db/users.json
```

```json
[
  {
    "id": "u_1",
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "role": "admin"
  }
]
```

The tool infers:

```txt
users collection
id field: id
fields: id, name, email, role
TypeScript type: User
REST routes
GraphQL fields
```

### Schema/Type-First Fixtures

Developers can define types without real data:

```txt
db/users.schema.jsonc
```

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

    "name": {
      "type": "string",
      "required": true,
      "description": "Display name shown in the UI."
    },

    "email": {
      "type": "string",
      "required": true,
      "description": "Unique email address."
    },

    "role": {
      "type": "enum",
      "values": ["admin", "user"],
      "required": false,
      "default": "user",
      "description": "Local authorization role."
    }
  },

  "seed": [
    {
      "id": "u_1",
      "name": "Ada Lovelace",
      "email": "ada@example.com",
      "role": "admin"
    }
  ]
}
```

This file acts as:

```txt
schema source
TypeScript source
REST/GraphQL source
optional default seed data
documentation source
```

### Mixed Mode

Developers can provide both a data fixture and a schema fixture:

```txt
db/users.json
db/users.schema.jsonc
```

In mixed mode:

```txt
users.schema.jsonc controls the type/schema
users.json controls the seed records
```

If the two disagree, the CLI reports the mismatch:

```txt
users.json has field "twitterHandle"
users.schema.jsonc does not define "twitterHandle"
```

Default behavior should be permissive in local development:

```txt
warn and allow
```

Configuration can enable stricter behavior:

```js
export default {
  schema: {
    unknownFields: 'warn', // "allow" | "warn" | "error"
  },
};
```

## Type Generation

By default, generated TypeScript types are written to:

```txt
.jsondb/types/index.ts
```

Projects can customize the output location:

```js
export default {
  sourceDir: './db',
  stateDir: './.jsondb',

  types: {
    enabled: true,

    // Default gitignored output.
    outFile: './.jsondb/types/index.ts',

    // Optional committed output.
    // If set, generate the same types here too.
    commitOutFile: './src/generated/jsondb.types.ts',

    // Optional.
    useReadonly: false,
    exportRuntimeHelpers: true,
  },
};
```

This supports two common workflows.

### Gitignored Generated Types

Good for quick local development:

```ts
import type { JsonDbTypes } from '../.jsondb/types/index';
```

### Committed Generated Types

Better for apps and CI:

```ts
import type { JsonDbTypes } from './generated/jsondb.types';
```

If the app relies on generated types, committing them is usually better because CI and other developers do not need to run `jsondb sync` before TypeScript can resolve imports.

## Example Generated TypeScript

From `users.schema.jsonc`, generate something like this:

```ts
export type UserRole = 'admin' | 'user';

export type User = {
  /** Stable user id. */
  id: string;

  /** Display name shown in the UI. */
  name: string;

  /** Unique email address. */
  email: string;

  /** Local authorization role. */
  role?: UserRole;
};

export type Settings = {
  theme?: string;
  locale?: string;
  features?: {
    billing?: boolean;
  };
};

export type JsonDbCollections = {
  users: User;
};

export type JsonDbDocuments = {
  settings: Settings;
};

export type JsonDbTypes = {
  collections: JsonDbCollections;
  documents: JsonDbDocuments;
};
```

Package usage:

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

const user = users.get('u_2');

if (user) {
  console.log(user.email);
}
```

Singleton document usage:

```ts
const settings = db.document('settings');

await settings.set('/theme', 'dark');

const value = settings.get('/theme');
```

## JavaScript Schema Sources

JSONC is useful, but a JavaScript schema file can be more expressive while staying simple.

```txt
db/users.schema.mjs
```

```js
import { collection, field } from 'json-fixture-db/schema';

export default collection({
  description: 'Users who can sign into the local test app.',
  idField: 'id',

  fields: {
    id: field.string({
      required: true,
      description: 'Stable user id.',
    }),

    name: field.string({
      required: true,
      description: 'Display name shown in the UI.',
    }),

    email: field.string({
      required: true,
      description: 'Unique email address.',
    }),

    role: field.enum(['admin', 'user'], {
      default: 'user',
      description: 'Local authorization role.',
    }),
  },

  seed: [
    {
      id: 'u_1',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      role: 'admin',
    },
  ],
});
```

This provides normal comments and a clean authoring API without requiring Node.js to load TypeScript files directly.

For v1, support:

```txt
.json
.jsonc
.csv
.schema.json
.schema.jsonc
.schema.mjs
```

Avoid `.ts` schema sources in v1 unless the project adds a build step or TypeScript loader. Node.js does not execute TypeScript directly in the same way it executes `.mjs`.

## Type-Only Fixtures

A schema file can define a resource without seed data.

```jsonc
{
  // Audit events generated during local development.
  "kind": "collection",
  "idField": "id",

  "fields": {
    "id": {
      "type": "string",
      "required": true
    },
    "type": {
      "type": "string",
      "required": true
    },
    "createdAt": {
      "type": "string",
      "required": true
    },
    "payload": {
      "type": "object",
      "required": false,
      "default": {}
    }
  },

  "seed": []
}
```

Generated runtime state:

```txt
.jsondb/state/auditEvents.json
```

```json
[]
```

Generated TypeScript:

```ts
export type AuditEvent = {
  id: string;
  type: string;
  createdAt: string;
  payload?: Record<string, unknown>;
};
```

Generated REST:

```txt
GET     /audit-events
GET     /audit-events/:id
POST    /audit-events
PATCH   /audit-events/:id
DELETE  /audit-events/:id
```

Generated GraphQL:

```graphql
type AuditEvent {
  id: ID!
  type: String
  createdAt: String
  payload: JSON
}
```

## Defaults

Defaults should be used in three places:

```txt
1. When creating new records through REST/GraphQL/package API.
2. When backfilling safe additive schema changes.
3. When initializing an empty runtime mirror.
```

Example schema:

```jsonc
{
  "kind": "collection",
  "idField": "id",
  "fields": {
    "id": {
      "type": "string",
      "required": true
    },
    "name": {
      "type": "string",
      "required": true
    },
    "role": {
      "type": "enum",
      "values": ["admin", "user"],
      "default": "user"
    },
    "active": {
      "type": "boolean",
      "default": true
    }
  }
}
```

Creating a user:

```bash
jsondb create users '{"id":"u_3","name":"Linus"}'
```

Stored result:

```json
{
  "id": "u_3",
  "name": "Linus",
  "role": "user",
  "active": true
}
```

## Comments And Descriptions

JSON itself does not support comments, so support comments through one or both of these:

```txt
.schema.jsonc
.schema.mjs
```

Comments are primarily for humans. For generated TypeScript and GraphQL docs, use machine-readable descriptions:

```jsonc
{
  "email": {
    "type": "string",
    "description": "Unique email address used for login."
  }
}
```

Generate:

```ts
export type User = {
  /** Unique email address used for login. */
  email: string;
};
```

And GraphQL:

```graphql
type User {
  "Unique email address used for login."
  email: String
}
```

## Config

Add this to `jsondb.config.mjs`:

```js
export default {
  sourceDir: './db',
  stateDir: './.jsondb',
  mode: 'mirror',

  types: {
    enabled: true,
    outFile: './.jsondb/types/index.ts',
    commitOutFile: './src/generated/jsondb.types.ts',
    useReadonly: false,
    emitComments: true,
  },

  schema: {
    source: 'auto', // "auto" | "data" | "schema"
    allowJsonc: true,
    unknownFields: 'warn', // "allow" | "warn" | "error"
    additiveChanges: 'auto',
    destructiveChanges: 'manual',
    typeChanges: 'manual',
  },

  defaults: {
    applyOnCreate: true,
    applyOnSafeMigration: true,
  },

  collections: {
    users: {
      idField: 'id',
    },
  },

  server: {
    host: '127.0.0.1',
    port: 7331,
    maxBodyBytes: 1048576,
  },

  rest: {
    enabled: true,
  },

  graphql: {
    enabled: true,
    path: '/graphql',
  },
};
```

## CLI

Add type-specific commands:

```bash
jsondb types
jsondb types --watch
jsondb types --out ./src/generated/jsondb.types.ts
```

Add schema commands:

```bash
jsondb schema
jsondb schema users
jsondb schema validate
```

`jsondb sync` should also regenerate types.

Expected output:

```txt
Loaded db/users.schema.jsonc
Loaded db/posts.json
Generated .jsondb/schema.generated.json
Generated .jsondb/types/index.ts
Generated src/generated/jsondb.types.ts
Synced runtime mirror
```

## REST And GraphQL Runtime

The package should keep protocol-specific implementation in dedicated modules:

```txt
src/rest/
src/graphql/
src/web/
```

REST should expose generated collection and singleton document routes.

REST should support sequential batch requests:

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

REST batches are non-transactional by design. Items execute in order, and earlier successful writes remain committed if a later item fails.

Schema-backed writes should validate declared field types before mutating runtime state. Required fields, primitive types, enum values, arrays, and nested objects should be checked for package API writes, REST writes, GraphQL mutations, `jsondb sync`, and `jsondb schema validate`.

The local server should also expose a built-in dependency-free viewer:

```txt
GET /__jsondb
```

The viewer should support:

```txt
resource list
collection table viewer
singleton document JSON viewer
selected JSON copy
CSV drag-and-drop import into db/
REST route specs with copy/paste examples
REST request runner
GraphQL SDL viewer
GraphQL query and mutation examples
GraphQL runner with variables
schema and field inspection
diagnostics summary
```

CSV data-first fixtures should be treated as collections. The first row is the header row, headers become JSON field names, values are parsed into records, and the runtime mirror is written as `.jsondb/state/<resource>.json`.

Collection fixtures should always have an id field. If a JSON/JSONC/CSV collection source omits `id`, generate counter ids in the runtime mirror, starting at `"1"` and avoiding existing ids. In default `mode: 'mirror'`, source files stay unchanged. In non-mirror source mode, write generated ids back to plain `.json` fixtures.

The runtime mirror should track source hashes for JSON, JSONC, and CSV files. If a source hash changes during sync, regenerate the JSON state for that resource from the source fixture. If the hash is unchanged, preserve runtime mirror edits.

The viewer should support uploading a CSV through:

```txt
POST /__jsondb/import
```

The upload should copy the CSV into `db/`, run sync, reload the in-memory resources, update the URL query parameter to the imported resource, and reload the dashboard view.

While serving, jsondb should watch `db/` for fixture and schema changes, ignoring `.jsondb/`. On change, reload resources and notify the single-file viewer through `/__jsondb/events` so the dashboard refreshes automatically. If one source file fails to parse or load, report a file-specific diagnostic in the viewer and keep the remaining valid resources available.

GraphQL should support a dependency-free subset suitable for local app development:

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

Supported GraphQL behavior:

```txt
queries
mutations
root and nested aliases
variables
object/list/scalar input values
collection list queries
collection single-record queries by id
collection create/update/delete mutations
singleton document queries
singleton document update/set mutations
selection-set projection
HTTP batching by posting an array to /graphql
```

Unsupported in the dependency-free v1 subset:

```txt
fragments
directives
subscriptions
full introspection
general-purpose GraphQL validation
```

## Repo Example Launcher

The repo should include an npm task that starts every example database and serves an index page of viewer links:

```bash
npm run examples
```

The index page should list each example and link to:

```txt
/__jsondb
/__jsondb/schema
/graphql
```

Examples should range from basic to advanced:

```txt
examples/basic
examples/data-first
examples/schema-first
examples/advanced
```

## Client API

Provide a small HTTP client for consuming jsondb from apps and tests:

```ts
import { createJsonDbClient } from 'json-fixture-db/client';

const client = createJsonDbClient({
  baseUrl: 'http://127.0.0.1:7331',
  batching: {
    enabled: true,
    delayMs: 0,
  },
});
```

The client should support:

```txt
client.graphql(query, variables)
client.graphql.batch(requests)
client.rest(method, path, body)
client.rest.batch(requests)
optional automatic batching for individual GraphQL and REST calls
10ms default automatic batching window
read-safe dedupe for identical REST GET and GraphQL query requests
explicit dedupe: 'all' opt-in for deduping writes and mutations
```

Local mock behavior should support latency and chaos errors:

```js
export default {
  mock: {
    delay: [50, 300],
    errors: {
      rate: 0.05,
      status: 503,
      message: 'Random local mock failure',
    },
  },
};
```

## Error Messages

Errors should be readable by humans and useful to AI agents. They should explain:

```txt
what failed
where it failed
what value was received when useful
what values or commands are valid
what to try next
```

REST and server errors should use this shape:

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

GraphQL errors should use standard GraphQL `errors[]` entries with `extensions`:

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
          "field": "nope",
          "availableFields": ["users", "user"]
        }
      }
    }
  ]
}
```

## Codex Prompt Add-On

Append this to the Codex prompt:

````md
## Type generation and schema-only fixtures

Add automatic TypeScript type generation.

By default, generated types should be written to:

```txt
.jsondb/types/index.ts
```

Also support a configurable committed output file:

```js
export default {
  types: {
    enabled: true,
    outFile: './.jsondb/types/index.ts',
    commitOutFile: './src/generated/jsondb.types.ts',
    emitComments: true,
    useReadonly: false
  }
};
```

If `commitOutFile` is set, generate the same TypeScript types there so users can import and commit them.

The generated file should export:

```ts
export type JsonDbCollections = {};
export type JsonDbDocuments = {};
export type JsonDbTypes = {
  collections: JsonDbCollections;
  documents: JsonDbDocuments;
};
```

For each collection, generate a record type:

```ts
export type User = {
  id: string;
  name: string;
  email: string;
  role?: 'admin' | 'user';
};
```

Use schema field descriptions to emit JSDoc comments.

Support schema-only fixtures.

The package should accept these source formats:

```txt
db/users.json              data-first fixture
db/users.jsonc             data-first fixture with comments
db/users.csv               data-first collection fixture
db/users.schema.jsonc      schema/type-first fixture
db/users.schema.mjs        schema/type-first fixture using JS helpers
```

The main source JSON/JSONC/CSV fixture can be used to infer schema and generate types.

A `.schema.jsonc` file can define a resource without seed data:

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

Support `.schema.mjs` files for richer authoring:

```js
import { collection, field } from 'json-fixture-db/schema';

export default collection({
  description: 'Users who can sign into the local test app.',
  idField: 'id',
  fields: {
    id: field.string({
      required: true,
      description: 'Stable user id.'
    }),
    role: field.enum(['admin', 'user'], {
      default: 'user',
      description: 'Local authorization role.'
    })
  },
  seed: []
});
```

Do not require TypeScript execution for schema files in v1. Use `.mjs` for executable schema definitions.

Rules:

1. If only `users.json` exists, infer schema from data.
2. If only `users.schema.json`, `users.schema.jsonc`, or `users.schema.mjs` exists, create the collection from schema and optional seed/default data.
3. If both `users.json` and `users.schema.*` exist, the schema file is authoritative for types and validation, while the JSON file provides seed data.
4. Additive fields are safe and automatic.
5. Removed fields and type changes require explicit approval.
6. Defaults should apply when creating records and when safely backfilling additive fields.
7. Generated TypeScript types should update during `jsondb sync`, `jsondb types`, and service startup when needed.

Add CLI commands:

```bash
jsondb types
jsondb types --watch
jsondb types --out ./src/generated/jsondb.types.ts
jsondb schema
jsondb schema validate
jsondb generate hono
jsondb generate hono --api rest,graphql --out ./server
jsondb generate hono --api none --app module
```

## Hono And SQLite Starter Generation

Add `jsondb generate hono` for graduating a fixture-backed app into a starter API backed by SQLite.

Default behavior:

```txt
outDir: ./jsondb-api
api: rest
db: sqlite
app: standalone
runtime: node-sqlite
seed: false
```

Generated output should be TypeScript-first and include a portable repository interface, SQLite adapter using `node:sqlite`, validators, initial SQL migration, and optional Hono REST/GraphQL route modules. Standalone output should include `package.json`, `tsconfig.json`, `src/app.ts`, and `src/server.ts`.

API selection:

```bash
jsondb generate hono --api rest
jsondb generate hono --api graphql
jsondb generate hono --api rest,graphql
jsondb generate hono --api none
```

SQLite generation rules:

```txt
collections -> SQLite tables with id TEXT PRIMARY KEY
documents -> _jsondb_documents(name TEXT PRIMARY KEY, value TEXT)
string/enum -> TEXT
number -> REAL
boolean -> INTEGER
object/array/unknown -> JSON text in TEXT columns
```

Generation should fail on schema errors. For production SQLite output, warning diagnostics should also block generation unless `--allow-warnings` is provided. Seed insertion is disabled by default; `--seed fixtures` can emit fixture seed support for local SQLite mimicry.

Keep Hono and SQLite runtime support isolated under optional exports:

```txt
json-fixture-db/hono
json-fixture-db/sqlite
```

The core package must not add mandatory Hono or SQLite npm dependencies.

Acceptance criteria:

* Data-first fixtures generate TypeScript types.
* Schema-only fixtures generate TypeScript types.
* JSONC schema comments are allowed.
* Field descriptions become JSDoc in generated TypeScript.
* `types.outFile` writes to `.jsondb/types/index.ts` by default.
* `types.commitOutFile` writes to a custom importable location.
* Package API can be typed with the generated `JsonDbTypes`.
````

The intended developer loop is:

```txt
create/edit JSON or schema fixtures
run jsondb sync
types are generated
REST and GraphQL are generated
runtime mirror is updated
source files stay clean unless writeback is requested
```
