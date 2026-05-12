# jsondb

A local JSON fixture database for app development and tests. Use it as a rapid prototyping layer before the real database or backend contract is settled, so the codebase can follow familiar data access patterns while the team learns the shape of the product. Put files in `db/`, browse them in a built-in data viewer, and call a local REST API without standing up a backend. It also generates TypeScript types and includes a focused GraphQL endpoint when you need it, but the default workflow is REST-first and configuration-light.

## Summary

Most projects should start with the happy path defaults:

1. Put JSON, JSONC, or CSV fixtures in `db/`.
2. Run `npm run db:sync` to generate `.jsondb/state`, schema metadata, and TypeScript types.
3. Run `npm run db:serve` to start the local API and data viewer.
4. Open `http://127.0.0.1:7331/__jsondb` to inspect data, import CSVs, read REST docs, and try requests.
5. Point your app or tests at REST routes like `GET /users` and `POST /users`. GraphQL is available at `/graphql`, but you do not need it to get the core workflow.
6. Add schema files only when you need required fields, defaults, enums, descriptions, or stricter validation.

That is the main value: fixture files become a browsable local data source and a writable REST API with no config, giving teams a realistic mock while the eventual database is still unknown.

By default jsondb runs in `mode: 'mirror'`, so app writes go into `.jsondb/state` and source fixtures stay clean. Switch to `mode: 'source'` only when you intentionally want jsondb to write generated ids back to plain `.json` fixtures.

Local responses include a small default delay range of `30-100ms` so loading states are visible during UI work. Configure `mock.delay` to `0` to disable it, `50` for a fixed delay, or `[50, 300]` for a different range.

## Quick Start

Until this package is published, install it from GitHub in the app or package that will use it:

```json
{
  "devDependencies": {
    "jsondb": "github:PatrickJS/jsondb"
  },
  "scripts": {
    "db": "jsondb",
    "db:sync": "jsondb sync",
    "db:serve": "jsondb serve",
    "db:types": "jsondb types"
  }
}
```

Then run `npm install`. The npm scripts use the local `node_modules/.bin/jsondb` binary installed for that repo, so each project gets its own CLI version. The `jsondb` dependency name is also the import name for helpers like `jsondb/config` and `jsondb/schema`.

jsondb uses `./db` by default.

```bash
mkdir -p db
```

Create `db/users.json`:

```json
[
  {
    "id": "u_1",
    "name": "Ada Lovelace",
    "email": "ada@example.com"
  }
]
```

Sync the runtime mirror and generated types:

```bash
npm run db:sync
```

Start the local API and viewer:

```bash
npm run db:serve
```

Open the data viewer:

```txt
http://127.0.0.1:7331/__jsondb
```

Call the REST API:

```bash
curl http://127.0.0.1:7331/users
```

```bash
curl -X POST http://127.0.0.1:7331/users \
  -H 'content-type: application/json' \
  -d '{"id":"u_2","name":"Grace Hopper","email":"grace@example.com"}'
```

The default sync output is gitignored runtime state:

```txt
.jsondb/schema.generated.json
.jsondb/types/index.ts
.jsondb/state/users.json
```

`serve` syncs on startup, watches the fixture folder, refreshes valid resources when files change, and surfaces file-specific diagnostics in the viewer without breaking unrelated resources.

## Use Cases

Use this table to start with defaults and then jump to the config only when a use case needs it.

| Use case                                | Start with                                                                  | Add config when                                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Browse and sanity-check local data      | `db/*.json`, `npm run db:serve`, and the [data viewer](#data-viewer)        | Fixtures live outside `db/`: [different fixture folder](#different-fixture-folder)                     |
| Prototype UI before the backend exists  | Default fixtures plus [REST API](#rest-api) calls from the app              | Adjust the default 30-100ms delay: [mock delay and errors](#mock-delay-and-errors)                    |
| Share local data across tests and demos | Default sync output in `.jsondb/state`                                      | Test imports need stable generated types: [committed generated types](#committed-generated-types)      |
| Import spreadsheet or product data      | `db/*.csv` or viewer CSV import                                             | CSVs belong in another folder: [different fixture folder](#different-fixture-folder)                   |
| Evolve fuzzy data into a contract       | Add `db/<name>.schema.json` or `.schema.jsonc`                              | Schema drift should fail instead of warn: [schema strictness](#schema-strictness)                      |
| Find fixture consistency issues         | `npm run db -- doctor`                                                      | CI should fail on warnings: `npm run db -- check --strict`                                            |
| Start from types before records exist   | Schema-first fixtures with empty `seed`                                     | You want mock records generated from schema: [generated schema seed data](#generated-schema-seed-data) |
| Exercise larger local payloads          | Default server settings                                                     | Requests exceed the local body limit: [server options](#server-options)                                |
| Graduate fixtures into a real service   | Stable schema-backed fixtures                                               | Generate a starter: [Hono and SQLite starter generation](#hono-and-sqlite-starter-generation)          |

## Configuration Map

The defaults are designed to be useful without `jsondb.config.mjs`. When you do need configuration, use this as the index.

| Need                                 | Default                       | Configure                                                                 | Why                                                                     |
| ------------------------------------ | ----------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Typed, commented config              | No config file required       | [Likely first config](#likely-first-config)                               | Get editor autocomplete and know the common values when you add config. |
| Fixture folder                       | `./db`                        | [Different fixture folder](#different-fixture-folder)                     | Keep fixtures in a package, example, or app-specific folder.            |
| Runtime state behavior               | `.jsondb`, mirror mode        | [Mirror vs source mode](#mirror-vs-source-mode)                           | Keep source fixtures clean, or intentionally write generated ids back.  |
| Importable generated types           | `.jsondb/types/index.ts`      | [Committed generated types](#committed-generated-types)                   | Let TypeScript imports work in CI and fresh checkouts before sync runs. |
| Unknown fields in schema-backed data | Warn                          | [Schema strictness](#schema-strictness)                                   | Move from permissive local data to stricter contracts.                  |
| Schema-only mock records             | Off                           | [Generated schema seed data](#generated-schema-seed-data)                 | Create local records from schema when no fixture data exists yet.       |
| Local latency                         | 30-100ms                      | [Mock delay and errors](#mock-delay-and-errors)                           | Disable it, use a fixed delay, or choose a different range.             |
| Random local failures                | Off                           | [Mock delay and errors](#mock-delay-and-errors)                           | Test retries and error UI once the happy path works.                    |
| Host, port, body limit               | `127.0.0.1:7331`, 1 MB bodies | [Server options](#server-options)                                         | Avoid port conflicts or allow larger local payloads.                    |
| Multiple REST calls in one request   | Available                     | [REST batching](#rest-batching)                                           | Batch local reads and writes through `POST /__jsondb/batch`.            |
| Production-ish API starter           | Not generated                 | [Hono and SQLite starter generation](#hono-and-sqlite-starter-generation) | Turn settled fixtures and schemas into a Hono/SQLite starter.           |

## Likely First Config

Most projects can skip config at first. When you do add `jsondb.config.mjs`, the most likely first knobs are mirror/source mode and mock delay.

Use `defineConfig` for editor autocomplete and inline type checks:

```js
// @ts-check
import { defineConfig } from 'jsondb/config';

export default defineConfig({
  // mirror keeps source fixtures unchanged and writes app edits to .jsondb/state.
  // source may write generated ids back to plain .json fixtures.
  mode: 'mirror',

  // Defaults to [30, 100]. Use 0 to disable, 50 for fixed delay,
  // or [50, 300] for a wider range.
  mock: {
    delay: [30, 100],
  },
});
```

See [jsondb.config.example.mjs](./jsondb.config.example.mjs) for a commented config file with the common values.

## Add Schema When It Pays For It

Data-first fixtures are enough until the shape matters. When you need defaults, enums, required fields, descriptions, or stricter write validation, add `db/<name>.schema.json`, `db/<name>.schema.jsonc`, or `db/<name>.schema.mjs`.

Create `db/users.schema.json`:

```json
{
  "kind": "collection",
  "idField": "id",
  "fields": {
    "id": { "type": "string", "required": true },
    "name": { "type": "string", "required": true },
    "email": {
      "type": "string",
      "required": true,
      "description": "Email address used for local sign-in."
    },
    "role": {
      "type": "enum",
      "values": ["admin", "user"],
      "default": "user",
      "description": "Local authorization role."
    },
    "lastViewedAt": {
      "type": "datetime",
      "description": "ISO timestamp for the last local view."
    },
    "ownerPersonId": {
      "type": "string",
      "nullable": true
    },
    "tags": {
      "type": "array",
      "items": { "type": "string" }
    },
    "schemaSnapshot": {
      "type": "object",
      "additionalProperties": true,
      "fields": {
        "version": { "type": "number" }
      }
    }
  }
}
```

Then validate:

```bash
npm run db -- schema validate
```

In mixed mode, schema files define the contract and data files provide seed records:

```txt
db/users.schema.json
db/users.json
```

By default, unknown fields produce warnings for local development. Use [schema strictness](#schema-strictness) when you want drift to fail.

Schema fields can use `nullable: true` when `null` is an intentional value. `datetime` fields validate as strings and generate TypeScript `string` types. Object fields can set `additionalProperties: true` when nested keys are intentionally flexible.

## Fixture Styles

### Data-First JSON Or JSONC

Use `db/users.json` or `db/users.jsonc` when you already have sample records and want jsondb to infer the collection schema.

```json
[
  {
    "id": "u_1",
    "name": "Ada Lovelace",
    "active": true
  }
]
```

Collections always get an id field. If a JSON, JSONC, or CSV collection fixture omits `id`, jsondb adds counter ids in the runtime mirror:

```json
[
  { "id": "1", "name": "Ada Lovelace" },
  { "id": "2", "name": "Grace Hopper" }
]
```

In default mirror mode, source files stay unchanged.

### CSV Fixtures

Use CSV when your fixture source starts in a spreadsheet or export.

```txt
db/users.csv
```

```csv
id,name,email,active
u_1,Ada Lovelace,ada@example.com,true
```

`npm run db -- sync` parses the header row, infers a collection schema, and writes `.jsondb/state/users.json`. Source hashes are tracked so changed source fixtures refresh the runtime mirror, while unchanged source fixtures preserve runtime edits.

When a CSV is paired with a schema file, array fields stay arrays in the runtime mirror. For example, a schema field like `"tags": { "type": "array", "items": { "type": "string" } }` accepts a CSV cell such as `renewal;priority` or a JSON array string such as `["renewal","priority"]` and writes `["renewal", "priority"]` to state.

### Schema-First Fixtures

Use schema-first fixtures when you know the contract before you have useful records.

```json
{
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
import { collection, field } from 'jsondb/schema';

export default collection({
  idField: 'id',
  fields: {
    id: field.string({ required: true }),
    role: field.enum(['admin', 'user'], { default: 'user' }),
    lastViewedAt: field.datetime(),
    ownerPersonId: field.nullable(field.string()),
    tags: field.array(field.string()),
    schemaSnapshot: field.object({
      version: field.number(),
    }, { additionalProperties: true }),
  },
  seed: [],
});
```

Supported source formats:

```txt
.json
.jsonc
.csv
.schema.json
.schema.jsonc
.schema.mjs
```

TypeScript schema files are intentionally not loaded directly in v1 because Node.js does not execute TypeScript without an explicit loader or build step.

## CLI

With the `db` script from the install snippet, run commands through npm:

```bash
npm run db -- sync
npm run db -- types
npm run db -- types --watch
npm run db -- types --out ./src/generated/jsondb.types.ts
npm run db -- schema
npm run db -- schema users
npm run db -- schema validate
npm run db -- create users '{"id":"u_2","name":"Grace Hopper","email":"grace@example.com"}'
npm run db -- serve
npm run db -- generate hono
npm run db -- generate hono --api rest,graphql --out ./server
```

Inside npm scripts, `jsondb` resolves to the local dependency binary. The equivalent binary commands are:

```bash
jsondb sync
jsondb types
jsondb types --watch
jsondb types --out ./src/generated/jsondb.types.ts
jsondb schema
jsondb schema users
jsondb schema validate
jsondb create users '{"id":"u_2","name":"Grace Hopper","email":"grace@example.com"}'
jsondb serve
jsondb generate hono
jsondb generate hono --api rest,graphql --out ./server
```

With pnpm, pass jsondb arguments directly to the script name:

```bash
pnpm jsondb sync
pnpm jsondb schema validate
pnpm jsondb serve
```

Run all repo examples and open an index of their viewers:

```bash
npm run examples
```

The examples index starts each example on its own port and lists links to each `/__jsondb` viewer.

## Data Viewer

Open the built-in viewer after starting the server:

```txt
http://127.0.0.1:7331/__jsondb
```

Opening `http://127.0.0.1:7331/` in a browser shows a small index with links to the data viewer, schema, GraphQL endpoint, and resource routes. API-style requests to `/` keep returning JSON discovery data by default.

The viewer is part of the default workflow. Use it to confirm that fixture data loaded correctly, inspect generated schema metadata, import CSV files, and try REST calls without writing client code first.

The viewer includes:

- resource and data browsing
- drag-and-drop CSV import into the configured fixture folder
- REST specs with copyable examples
- a REST request runner
- GraphQL SDL and operation references
- schema and field inspection
- source diagnostics when one fixture file is broken

## Fixture Doctor

Use `doctor` when plain fixtures are starting to act like a small local data model and you want consistency suggestions:

```bash
npm run db -- doctor
```

It reports existing schema/source diagnostics plus advisory fixture health findings such as:

- likely relations, for example `todos.userId -> users.id`
- duplicate ids inside a collection
- mixed id value types like `"1"` and `1`
- inconsistent field types like `done: true` and `done: "yes"`
- likely relation fields with values missing from the target collection

Relation inference is only a suggestion. It does not rewrite schema files and it does not make `?expand=user` work until you add explicit relation metadata.

For scripts or CI, use JSON output or strict mode:

```bash
npm run db -- doctor --json
npm run db -- check --strict
```

`doctor` exits nonzero for error diagnostics. `--strict` also exits nonzero for warnings. Informational suggestions do not fail strict mode.

## REST API

The local server exposes REST routes for collections and singleton documents:

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

REST examples:

```bash
curl http://127.0.0.1:7331/users
```

Use `select`, `offset`, and `limit` when a prototype only needs part of a collection:

```bash
curl 'http://127.0.0.1:7331/users?select=id,name&offset=0&limit=20'
```

```bash
curl http://127.0.0.1:7331/users/u_1
```

```bash
curl -X POST http://127.0.0.1:7331/users \
  -H 'content-type: application/json' \
  -d '{"id":"u_2","name":"Grace Hopper","email":"grace@example.com"}'
```

```bash
curl -X PATCH http://127.0.0.1:7331/users/u_2 \
  -H 'content-type: application/json' \
  -d '{"name":"Rear Admiral Grace Hopper"}'
```

```bash
curl -X DELETE http://127.0.0.1:7331/users/u_2
```

### Relationship Expansion

Schema-backed scalar fields can declare relation metadata while fixtures keep plain ids:

```json
{
  "authorId": {
    "type": "string",
    "required": true,
    "relation": {
      "name": "author",
      "to": "users",
      "toField": "id",
      "cardinality": "one"
    }
  }
}
```

Then REST can explicitly expand that to-one relation:

```bash
curl 'http://127.0.0.1:7331/posts/p_1?expand=author&select=id,title,author.name'
```

`select` supports top-level fields and one nested expanded relation field. Relation expansion is depth 1 in this MVP, and reverse to-many expansion is intentionally deferred.

jsondb also exposes a dependency-free GraphQL subset at `/graphql` for apps that prefer GraphQL. This README stays REST-first because REST plus the data viewer is the intended default path.

### REST Batching

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

GraphQL is available for apps that need it; REST remains the documented happy path here.

## Package API

```ts
import { openJsonFixtureDb } from 'jsondb';

const db = await openJsonFixtureDb({
  dbDir: './db',
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

Import generated `JsonDbTypes` from `.jsondb/types/index.ts` or from a committed output file when you want typed collection names and records.

Singleton document usage:

```ts
const settings = db.document('settings');

await settings.set('/theme', 'dark');

const value = settings.get('/theme');
```

Or use the small HTTP client for REST calls:

```ts
import { createJsonDbClient } from 'jsondb/client';

const client = createJsonDbClient({
  baseUrl: 'http://127.0.0.1:7331',
  batching: true,
});

const users = await client.rest.get('/users');

await client.rest.post('/users', {
  id: 'u_2',
  name: 'Grace Hopper',
  email: 'grace@example.com',
});

const batch = await client.rest.batch([
  { method: 'GET', path: '/users' },
  { method: 'GET', path: '/settings' },
]);
```

The client can batch requests made within a short timeout. The default batching window is `10ms`. Identical REST `GET` requests are deduped by default, while writes are not deduped unless you explicitly choose `dedupe: 'all'`.

## Vite Dev Server Plugin

Vite apps can mount jsondb into the existing dev server instead of running `jsondb serve` on a second port:

```js
import { defineConfig } from 'vite';
import { jsondbPlugin } from 'jsondb/vite';

export default defineConfig({
  plugins: [
    jsondbPlugin(),
  ],
});
```

The plugin is dev-only (`apply: 'serve'`). It does not run during `vite build`, and it does not add a mandatory Vite dependency to jsondb.

By default, dev routes are scoped so they do not steal app URLs:

```txt
GET  /__jsondb
GET  /__jsondb/schema
POST /__jsondb/batch
POST /__jsondb/graphql
GET  /__jsondb/rest/users
GET  /__jsondb/rest/users/u_1
```

Use the virtual browser client from app code when you want the same scoped paths:

```ts
import jsondb from 'virtual:jsondb/client';

const users = await jsondb.rest.get('/users');
const selected = await jsondb.rest.get('/users?select=id,name');
```

Plugin options include `cwd`, `dbDir`, `stateDir`, `apiBase`, `restBasePath`, `graphqlPath`, `rootRoutes`, `clientVirtualModule`, and `clientImport`. Set `rootRoutes: true` only when you intentionally want Vite dev to also answer unscoped routes like `/users`; standalone `jsondb serve` keeps those root REST routes by default.

## Type Generation

By default, generated TypeScript types are written to:

```txt
.jsondb/types/index.ts
```

Generated field descriptions become TypeScript JSDoc:

```ts
export type User = {
  /** Stable user id. */
  id: string;

  /** Email address used for local sign-in. */
  email: string;

  /** Local authorization role. */
  role?: 'admin' | 'user';
};
```

For apps and CI, you can also configure a [committed generated types](#committed-generated-types) output file.

## Hono And SQLite Starter Generation

When fixtures and schemas have settled enough to graduate toward a real database API, generate a Hono starter:

```bash
npm run db -- generate hono
npm run db -- generate hono --api rest,graphql --out ./server
npm run db -- generate hono --api none --app module
```

The default output is `./jsondb-api` with REST routes, a portable repository interface, a `node:sqlite` adapter, validators, and an initial SQL migration. Generated standalone apps are TypeScript-first and target Node.js `>=22.13` because SQLite output uses `node:sqlite`.

The main package stays dependency-light. Generated apps declare their own `hono`, `@hono/node-server`, `typescript`, and `tsx` dependencies. Generation fails on schema errors and, by default, on schema warnings so production starter code only uses declared schema fields. Pass `--allow-warnings` only when you intentionally want to generate with warning diagnostics.

Optional runtime exports are available for apps that want to use this package directly with Hono or SQLite:

```ts
import { Hono } from 'hono';
import { createJsonDbHonoApp } from 'jsondb/hono';

const app = new Hono();
app.route('/api', await createJsonDbHonoApp({
  dbDir: './db',
  storage: {
    kind: 'sqlite',
    file: './data/app.sqlite',
  },
  api: ['rest'],
}));
```

## Configuration Details

Create `jsondb.config.mjs` only when the defaults stop being enough. Use `defineConfig` so editors can show valid values and comments from the package types.

```js
// @ts-check
import { defineConfig } from 'jsondb/config';

export default defineConfig({
  dbDir: './db',
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
    unknownFields: 'warn', // "allow" | "warn" | "error"
  },

  seed: {
    generateFromSchema: false,
    generatedCount: 5,
  },

  server: {
    host: '127.0.0.1',
    port: 7331,
    maxBodyBytes: 1048576,
  },

  mock: {
    delay: [30, 100],
    errors: null,
  },
});
```

### Different Fixture Folder

Use `dbDir` when fixtures live somewhere other than `./db`:

```js
import { defineConfig } from 'jsondb/config';

export default defineConfig({
  dbDir: './jsondb',
});
```

Existing `sourceDir` configs still work; `dbDir` is the shorter fixture-folder name. If both are provided, `sourceDir` wins for backwards compatibility.

### Mirror Vs Source Mode

Use `mode: 'mirror'` when source fixtures should stay unchanged. This is the default and the safest path for local development because writes go to `.jsondb/state`.

Use `mode: 'source'` only when you intentionally want generated ids written back to plain `.json` collection fixtures:

```js
import { defineConfig } from 'jsondb/config';

export default defineConfig({
  mode: 'source',
});
```

### Committed Generated Types

Use `types.commitOutFile` when TypeScript imports should work before anyone runs sync:

```js
import { defineConfig } from 'jsondb/config';

export default defineConfig({
  types: {
    commitOutFile: './src/generated/jsondb.types.ts',
  },
});
```

### Schema Strictness

Use strict unknown-field checks when schema-backed fixtures should reject drift:

```js
import { defineConfig } from 'jsondb/config';

export default defineConfig({
  schema: {
    unknownFields: 'error',
  },
});
```

Keep the default `warn` while the fixture shape is still changing.

### Generated Schema Seed Data

Use generated schema seed data when a schema-only resource should start with mock records:

```js
import { defineConfig } from 'jsondb/config';

export default defineConfig({
  seed: {
    generateFromSchema: true,
    generatedCount: 5,
  },
});
```

When enabled, jsondb generates runtime state only for schema-only resources that have empty seed data. Data files in `db/*.json`, `db/*.jsonc`, and `db/*.csv` remain the source of truth when present.

### Mock Delay And Errors

jsondb delays local responses by `30-100ms` by default so loading states are visible during UI work. Use `0` to disable delay, a number like `50` for a fixed delay, or a tuple like `[50, 300]` for a range.

Random errors stay off by default. Turn them on when you want to test retries and error UI:

```js
import { defineConfig } from 'jsondb/config';

export default defineConfig({
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
});
```

Fixed or disabled delay examples:

```js
import { defineConfig } from 'jsondb/config';

export default defineConfig({
  mock: {
    delay: 0,
  },
});
```

```js
import { defineConfig } from 'jsondb/config';

export default defineConfig({
  mock: {
    delay: 50,
  },
});
```

Range shorthand:

```js
import { defineConfig } from 'jsondb/config';

export default defineConfig({
  mock: {
    delay: [50, 300],
    errors: 0.05,
  },
});
```

### Server Options

Use `server` when you need a different host, port, or JSON body limit:

```js
import { defineConfig } from 'jsondb/config';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 7331,
    maxBodyBytes: 1048576,
  },
});
```

See [SPEC.md](./SPEC.md) for the full product model.
