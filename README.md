# jsondb

A local JSON fixture database for app development and tests. Use it as a rapid prototyping layer before the real database or backend contract is settled, so the codebase can follow familiar data access patterns while the team learns the shape of the product. Put files in `db/`, browse them in a built-in data viewer, and call a local REST API without standing up a backend. It also generates TypeScript types and includes a focused GraphQL endpoint when you need it, but the default workflow is REST-first and configuration-light.

## Summary

Most projects should start with the happy path defaults:

1. Put JSON, JSONC, or CSV fixtures in `db/`, either at the top level or in nested folders.
2. Run `npm run db:sync` to generate `.jsondb/state`, schema metadata, and TypeScript types.
3. Run `npm run db:serve` to start the local API and data viewer.
4. Open `http://127.0.0.1:7331/__jsondb` to inspect data, import CSVs, read REST docs, and try requests.
5. Point your app or tests at REST routes like `GET /users` and `POST /users`. GraphQL is available at `/graphql`, but you do not need it to get the core workflow.
6. Add schema files only when you need required fields, defaults, enums, descriptions, or stricter validation.

That is the main value: fixture files become a browsable local data source and a writable REST API with no config, giving teams a realistic mock while the eventual database is still unknown.

By default jsondb runs in `mode: 'mirror'`, so app writes go into `.jsondb/state` and source fixtures stay clean. Switch to `mode: 'source'` only when you intentionally want jsondb to write generated ids back to plain `.json` fixtures.

Local responses include a small default delay range of `30-100ms` so loading states are visible during UI work. Configure `mock.delay` to `0` to disable it, `50` for a fixed delay, or `[50, 300]` for a different range.

For the codebase map and local trust boundaries, see [docs/architecture.md](./docs/architecture.md).

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

## Which Example Should I Start With?

The examples are a learning path. Run any example with `node ./src/cli.js sync --cwd ./examples/<name>` and `node ./src/cli.js serve --cwd ./examples/<name>`, or run `npm run examples` to start every viewer from one index.

| If you want to learn...                       | Start with                                      | What it shows                                                     |
| --------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------- |
| The shortest schema-backed workflow           | [`examples/basic`](./examples/basic)            | Sync, viewer, REST create, committed generated types              |
| Plain data before schemas exist               | [`examples/data-first`](./examples/data-first)  | Inferred collections, documents, routes, and types                |
| Contract-first resources                      | [`examples/schema-first`](./examples/schema-first) | Schema-only resources, empty seed records, committed types     |
| Calling jsondb from app or test code          | [`examples/rest-client`](./examples/rest-client) | `createJsonDbClient`, direct REST calls, REST batching          |
| Related local records                         | [`examples/relations`](./examples/relations)    | Relation metadata, `expand`, and nested `select`                  |
| CSV as the source of truth                    | [`examples/csv`](./examples/csv)                | CSV inference, source hashes, mirror refreshes                    |
| Admin/CMS-style field metadata                | [`examples/schema-manifest`](./examples/schema-manifest) | `schemaOutFile` and manifest customization              |
| Diagnostics for schema/data drift             | [`examples/diagnostics`](./examples/diagnostics) | Warnings surfaced without breaking unrelated resources          |
| Several advanced features together            | [`examples/advanced`](./examples/advanced)      | `.schema.mjs`, mixed mode, defaults, nested objects               |

## Use Cases

Use this table to start with defaults and then jump to the config only when a use case needs it.

| Use case                                | Start with                                                                  | Add config when                                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Browse and sanity-check local data      | `db/*.json`, `npm run db:serve`, and the [data viewer](#data-viewer)        | Fixtures live outside `db/`: [different fixture folder](#different-fixture-folder)                     |
| Prototype UI before the backend exists  | Default fixtures plus [REST API](#rest-api) calls from the app              | Adjust the default 30-100ms delay: [mock delay and errors](#mock-delay-and-errors)                    |
| Share local data across tests and demos | Default sync output in `.jsondb/state`                                      | Test imports need stable generated types: [committed generated types](#committed-generated-types)      |
| Keep old demo pages while refactoring   | Main `db/` for the new shape                                                | Legacy pages need their own source shape: [database forks](#database-forks)                           |
| Import spreadsheet or product data      | `db/*.csv` or viewer CSV import                                             | CSVs belong in another folder: [different fixture folder](#different-fixture-folder)                   |
| Keep another schema/data format         | Built-in JSON, JSONC, CSV, or `.schema.mjs` readers                         | Add a [source reader](#source-readers) that returns jsondb schema/data inputs                          |
| Build model-driven admin/CMS screens    | Nested fixtures such as `db/cms/pages.schema.jsonc`                         | Forms need committed field metadata: [schema manifest output](#schema-manifest-output)                 |
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
| Custom source formats                | Built-in readers               | [Source readers](#source-readers)                                         | Parse YAML, Excel, CMS exports, or model files into jsondb inputs.      |
| Nested resource names                | Fixture basename              | [Nested fixture folders](#nested-fixture-folders)                         | Avoid collisions and control REST/GraphQL names for organized fixtures. |
| Runtime state behavior               | `.jsondb`, mirror mode        | [Mirror vs source mode](#mirror-vs-source-mode)                           | Keep source fixtures clean, or intentionally write generated ids back.  |
| Importable generated types           | `.jsondb/types/index.ts`      | [Committed generated types](#committed-generated-types)                   | Let TypeScript imports work in CI and fresh checkouts before sync runs. |
| Importable schema manifest           | Off                           | [Schema manifest output](#schema-manifest-output)                         | Generate runtime field metadata for model-driven admin/CMS forms.       |
| Unknown fields in schema-backed data | Warn                          | [Schema strictness](#schema-strictness)                                   | Move from permissive local data to stricter contracts.                  |
| Schema-only mock records             | Off                           | [Generated schema seed data](#generated-schema-seed-data)                 | Create local records from schema when no fixture data exists yet.       |
| Local latency                         | 30-100ms                      | [Mock delay and errors](#mock-delay-and-errors)                           | Disable it, use a fixed delay, or choose a different range.             |
| Random local failures                | Off                           | [Mock delay and errors](#mock-delay-and-errors)                           | Test retries and error UI once the happy path works.                    |
| Temporary legacy database shapes      | Off                           | [Database forks](#database-forks)                                         | Run old and new local data contracts from one dev server.               |
| Host, port, body limit               | `127.0.0.1:7331`, 1 MB bodies | [Server options](#server-options)                                         | Avoid port conflicts or allow larger local payloads.                    |
| Multiple REST calls in one request   | Available                     | [REST batching](#rest-batching)                                           | Batch local reads and writes through `POST /__jsondb/batch`.            |
| REST response formats                | JSON                          | [REST formats](#rest-formats)                                             | Render `.json`, `.md`, `.html`, or other GET formats from config.       |
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

Data-first fixtures are enough until the shape matters. When you need defaults, enums, required fields, descriptions, constraints, or stricter write validation, add `db/<name>.schema.json`, `db/<name>.schema.jsonc`, or `db/<name>.schema.mjs`.

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
      "unique": true,
      "pattern": "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$",
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
      "maxLength": 5,
      "items": { "type": "string" }
    },
    "score": {
      "type": "number",
      "min": 0,
      "max": 100
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

Field constraints are checked during `sync`, schema validation, package API writes, REST writes, and GraphQL mutations. Use `unique: true` for collection fields that must not repeat, `min`/`max` for numbers, `minLength`/`maxLength` for strings or arrays, and `pattern` for string regular expression checks.

## Source Readers

jsondb reads all source files through a reader pipeline. The built-in readers handle `.json`, `.jsonc`, `.csv`, `.schema.json`, `.schema.jsonc`, and `.schema.mjs`. Add `sources.readers` when another file format should remain the source of truth.

Readers parse files into raw jsondb inputs. jsondb still owns resource naming, schema normalization, validation, generated ids, TypeScript types, schema manifests, REST, GraphQL, and sync.

```js
// jsondb.config.mjs
// @ts-check
import { defineConfig } from 'jsondb/config';

export default defineConfig({
  sources: {
    readers: [
      {
        name: 'pipe-data',
        match({ file }) {
          return file.endsWith('.pipe');
        },
        async read({ readText }) {
          const rows = (await readText()).trim().split('\n');
          return {
            kind: 'data',
            resourceName: 'users',
            format: 'pipe',
            data: rows.map((row) => {
              const [id, name] = row.split('|');
              return { id, name };
            }),
          };
        },
      },
    ],
  },
});
```

Custom readers run before built-in readers. The first reader that returns a result owns the file; returning `null` lets the next reader try. A reader can also return `{ kind: 'schema', schema }` for schema-first sources. One file may return multiple sources, such as one Excel workbook with several sheets, but every returned source must include `resourceName`.

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
npm run db -- schema manifest --out ./src/generated/jsondb.schema.json
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
jsondb schema manifest --out ./src/generated/jsondb.schema.json
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
- configured forks with missing folders, invalid names, or schema/source diagnostics

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

### REST Formats

Resource `GET` routes return JSON by default. The explicit `.json` extension uses the same shaped data:

```txt
GET /users
GET /users.json
GET /users/u_1
GET /users/u_1.json
```

You can override extensionless output with `rest.formats.default`, override `.json` with `rest.formats.json`, and add formats such as `.md` or `.html` from config. Format renderers receive data after normal REST shaping, so `select`, `expand`, `offset`, and `limit` still apply before rendering.

```js
import { defineConfig } from 'jsondb/config';

export default defineConfig({
  rest: {
    formats: {
      default: 'json',

      json({ data }) {
        return {
          body: JSON.stringify({ data }, null, 2),
          contentType: 'application/json; charset=utf-8',
        };
      },

      md({ resourceName, data }) {
        return {
          body: `# ${resourceName}\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n`,
          contentType: 'text/markdown; charset=utf-8',
        };
      },

      html({ data }) {
        return {
          body: `<!doctype html><html><body><pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre></body></html>`,
          contentType: 'text/html; charset=utf-8',
        };
      },
    },
  },
});
```

With that config:

```txt
GET /users       -> rest.formats.default, which delegates to json above
GET /users.json  -> rest.formats.json
GET /users.md    -> rest.formats.md
GET /users.html  -> rest.formats.html
```

Frameworks can hook into `.html` by importing their own server renderer inside `jsondb.config.mjs` and returning the final HTML string. jsondb does not execute `.jsx` routes directly; JSX is a source/runtime choice for your renderer, while `.html` is the response format.

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

jsondb also exposes a dependency-free GraphQL subset at `/graphql` for apps that prefer GraphQL. It supports aliases, variables, `operationName`, `__typename`, named and inline fragments, `@include`/`@skip`, HTTP batching, and minimal `__schema`/`__type` introspection for local tooling. This README stays REST-first because REST plus the data viewer is the intended default path.

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

## Database Forks

Use database forks when part of an app needs to keep an older fixture shape while other pages move to a new shape. The main `db/` folder remains the default database, and each fork gets its own committed source folder plus its own generated runtime state:

```txt
db/                         current database shape
db.forks/legacy-demo/       old demo/page shape
.jsondb/state/              generated state for db/
.jsondb/forks/legacy-demo/  generated state for the fork
```

Declare forks in `jsondb.config.mjs`:

```js
import { defineConfig } from 'jsondb/config';

export default defineConfig({
  forks: ['legacy-demo'],
});
```

`legacy-demo` maps to `db.forks/legacy-demo` by default. For a custom folder, use object form:

```js
export default defineConfig({
  forks: {
    'legacy-demo': {
      dbDir: './fixtures/legacy-demo',
    },
  },
});
```

App code can target the fork with the HTTP client:

```ts
import { createJsonDbClient } from 'jsondb/client';

const legacyDb = createJsonDbClient({
  baseUrl: 'http://127.0.0.1:7331',
  fork: 'legacy-demo',
});

const users = await legacyDb.rest.get('/users');
```

In Vite apps using `jsondbPlugin()`, the virtual client exposes the same helper without repeating paths:

```ts
import jsondb, { fork } from 'virtual:jsondb/client';

const users = await jsondb.rest.get('/users');
const legacyUsers = await fork('legacy-demo').rest.get('/users');
```

The helper is also attached to the default client as `jsondb.fork('legacy-demo')`.

The `fork` option derives the fork-scoped routes automatically:

```txt
GET  /__jsondb/forks/legacy-demo/rest/users
POST /__jsondb/forks/legacy-demo/batch
POST /__jsondb/forks/legacy-demo/graphql
GET  /__jsondb/forks/legacy-demo/schema
```

Fork names are folder-style slugs: letters, numbers, underscores, and hyphens. `jsondb doctor` reports missing configured fork folders and invalid fork names, so CI can catch a fork source folder that was not checked in.

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
import jsondb, { fork } from 'virtual:jsondb/client';

const users = await jsondb.rest.get('/users');
const selected = await jsondb.rest.get('/users?select=id,name');

const legacyDb = fork('legacy-demo');
const legacyUsers = await legacyDb.rest.get('/users');
```

Plugin options include `cwd`, `dbDir`, `stateDir`, `forks`, `apiBase`, `restBasePath`, `graphqlPath`, `rootRoutes`, `clientVirtualModule`, and `clientImport`. Set `rootRoutes: true` only when you intentionally want Vite dev to also answer unscoped routes like `/users`; standalone `jsondb serve` keeps those root REST routes by default.

The plugin watches fixture sources, not generated runtime output. jsondb also skips rewriting generated and state files when their content is unchanged, so normal `sync` or `openJsonFixtureDb()` calls should not trigger Vite reloads by changing mtimes alone.

If your app commits generated jsondb files under its frontend source tree, Vite may still reload when those files genuinely change. You can defensively ignore them in the app's own Vite config when they are type-only or not imported at runtime:

```ts
export default defineConfig({
  server: {
    watch: {
      ignored: [
        '../.jsondb/**',
        'src/generated/jsondb.schema.json',
        'src/generated/jsondb.generated.ts',
      ],
    },
  },
});
```

Only ignore generated files that the browser does not need to hot reload. If app code imports a generated schema or client artifact at runtime, let Vite watch it so real jsondb changes are visible during development.

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

  schemaOutFile: './src/generated/jsondb.schema.json',
  schemaManifest: {
    customizeField({ fieldName, defaultManifest }) {
      if (fieldName.endsWith('Markdown')) {
        return {
          ...defaultManifest,
          ui: {
            ...defaultManifest.ui,
            component: 'markdown',
          },
        };
      }

      return defaultManifest;
    },
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

  forks: ['legacy-demo'],
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

### Nested Fixture Folders

Fixtures can be grouped into folders under `db/` without changing their resource names. jsondb discovers supported files recursively, and the resource name still comes from the fixture basename:

```txt
db/
  cms/
    pages.schema.jsonc
    pages.json
  analytics/
    charts.schema.jsonc
    charts.json
```

That layout creates `pages` and `charts` resources, writes runtime mirrors to `.jsondb/state/pages.json` and `.jsondb/state/charts.json`, and keeps the nested source path available in sync metadata and schema manifest customization hooks. Keep fixture basenames unique across nested folders so each basename maps to one resource.

This is useful for admin and CMS projects where fixtures often belong near a content domain, but the app still wants simple resource names and routes such as `GET /pages`, `POST /pages`, and `GET /charts`.

If nested folders contain the same basename, configure how paths become resource names:

```js
import { defineConfig } from 'jsondb/config';

export default defineConfig({
  resources: {
    naming: 'folder-prefixed',
  },
});
```

Naming options:

| Option              | Example path                 | Resource name    | Use when                                                                 |
| ------------------- | ---------------------------- | ---------------- | ------------------------------------------------------------------------ |
| `basename`          | `db/cms/pages.json`          | `pages`          | You want the simplest, most stable API and fixture basenames are unique. |
| `folder-prefixed`   | `db/cms/pages.json`          | `cmsPages`       | Folders are domains and repeated filenames such as `pages.json` are common. |
| `path`              | `db/cms/landing/pages.json`  | `cmsLandingPages` | Deep folder structure should become part of the API name. Moving files changes API names. |
| `customizeResource` | `db/marketing/pages.json`    | `landingPages`   | Public API names must be explicit and stable.                            |

Resource names affect every public data surface:

```txt
db/cms/pages.json       -> cmsPages
db/marketing/pages.json -> marketingPages

State:
.jsondb/state/cmsPages.json

REST:
GET /cms-pages
GET /cms-pages.json

GraphQL:
query { cmsPages { id } }
mutation { createMarketingPage(input: { id: "home" }) { id } }

TypeScript:
JsonDbCollections["cmsPages"]

Relations:
{ "relation": { "to": "cmsPages" } }
```

For hand-picked names, use the same visitor pattern as schema manifest customization:

```js
import { defineConfig } from 'jsondb/config';

export default defineConfig({
  resources: {
    customizeResource({ file, defaultResource }) {
      if (file === 'db/cms/pages.json' || file === 'db/cms/pages.schema.jsonc') {
        return { ...defaultResource, name: 'cmsPages' };
      }

      if (file === 'db/marketing/pages.json' || file === 'db/marketing/pages.schema.jsonc') {
        return { ...defaultResource, name: 'marketingPages' };
      }

      return defaultResource;
    },
  },
});
```

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

### Schema Manifest Output

Use `schemaOutFile` when a local admin or CMS UI needs runtime schema metadata instead of hand-coded forms:

```js
import { defineConfig } from 'jsondb/config';

export default defineConfig({
  schemaOutFile: './src/generated/jsondb.schema.json',
});
```

`jsondb sync` writes the manifest when `schemaOutFile` is set. You can also generate it directly:

```bash
jsondb schema manifest --out ./src/generated/jsondb.schema.json
```

The JSON manifest groups `collections` and `documents`, includes normalized field metadata such as `type`, `required`, `nullable`, `default`, `values`, nested `fields`, array `items`, and `relation`, and adds inferred `ui` defaults. Defaults are metadata only; they do not change fixtures, seed data, runtime state, REST, or GraphQL behavior.

For example, these CMS fixtures:

```txt
db/
  cms/
    pages.schema.jsonc
    pages.json
  analytics/
    charts.schema.jsonc
    charts.json
```

can generate a committed manifest like this:

```json
{
  "version": 1,
  "collections": {
    "pages": {
      "kind": "collection",
      "name": "pages",
      "idField": "id",
      "fields": {
        "id": {
          "type": "string",
          "required": true,
          "nullable": false,
          "ui": {
            "label": "Id",
            "component": "text",
            "readonly": true
          }
        },
        "blocks": {
          "type": "array",
          "required": false,
          "nullable": false,
          "items": {
            "type": "object",
            "required": false,
            "nullable": false,
            "fields": {
              "type": {
                "type": "enum",
                "required": true,
                "nullable": false,
                "values": ["chart", "metric"]
              },
              "chartId": {
                "type": "string",
                "required": false,
                "nullable": false
              }
            }
          },
          "ui": {
            "label": "Blocks",
            "component": "list"
          }
        }
      }
    }
  },
  "documents": {}
}
```

Override resource or field output with `schemaManifest.customizeResource` and `schemaManifest.customizeField`. These hooks are intended for app-specific admin/CMS presentation metadata: reusable form components, labels, relation pickers, sections, ordering, readonly policy hints, and fields that should not appear in generated forms. Keep those hints in config or generated manifests; fixture records do not need `ui`, `editor`, or other jsondb-specific properties.

```js
import { defineConfig, mergeManifest } from 'jsondb/config';

export default defineConfig({
  schemaOutFile: './src/generated/jsondb.schema.json',
  schemaManifest: {
    customizeResource({ file, defaultManifest }) {
      return mergeManifest(defaultManifest, {
        editor: {
          group: file?.startsWith('db/cms/') ? 'CMS' : 'Data',
        },
      });
    },

    customizeField({ resourceName, fieldName, path, file, defaultManifest }) {
      if (resourceName !== 'pages') {
        return defaultManifest;
      }

      if (path === 'blocks') {
        return mergeManifest(defaultManifest, {
          editor: {
            component: 'block-list',
            source: file,
          },
        });
      }

      if (fieldName === 'type') {
        return mergeManifest(defaultManifest, {
          values: ['chart', 'metric'],
          editor: {
            component: 'select',
            label: 'Block type',
          },
        });
      }

      if (fieldName === 'chartId') {
        return mergeManifest(defaultManifest, {
          editor: {
            component: 'relation-select',
            relationTo: 'charts',
          },
        });
      }

      if (fieldName === 'aggregate' || fieldName === 'format' || fieldName === 'size') {
        const values = fieldName === 'aggregate'
          ? ['count', 'sum', 'avg', 'min', 'max', 'latest']
          : fieldName === 'format'
            ? ['number', 'currency', 'percent']
            : ['small', 'medium', 'large'];

        return mergeManifest(defaultManifest, {
          values,
          editor: {
            component: 'select',
          },
        });
      }

      if (fieldName === 'title' || fieldName === 'description') {
        return mergeManifest(defaultManifest, {
          editor: {
            component: 'textarea',
          },
        });
      }

      return defaultManifest;
    },
  },
});
```

The generated output can then carry your app's form metadata while preserving normalized schema metadata:

```json
{
  "type": "array",
  "required": false,
  "nullable": false,
  "items": {
    "type": "object",
    "required": false,
    "nullable": false,
    "fields": {
      "type": {
        "type": "enum",
        "required": true,
        "nullable": false,
        "values": ["chart", "metric"],
        "ui": {
          "component": "select",
          "label": "Block type"
        }
      },
      "chartId": {
        "type": "string",
        "required": false,
        "nullable": false,
        "ui": {
          "component": "relation-select",
          "relationTo": "charts"
        }
      }
    }
  },
  "ui": {
    "label": "Blocks",
    "component": "block-list",
    "source": "db/cms/pages.schema.jsonc"
  }
}
```

`customizeField` receives these arguments:

| Argument          | Meaning                                                                 | Useful when                                                                                  |
| ----------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `resourceName`    | Resource key such as `pages` or `charts`.                               | Apply UI rules to one collection or document.                                                 |
| `fieldName`       | Current field's local name, such as `chartId`.                          | Match repeated field conventions across nested objects, arrays, and resources.                |
| `path`            | Dot path inside the resource, such as `blocks.type` or `seo.title`.     | Target one nested field, preserve form ordering, or create section keys.                      |
| `file`            | Relative source path, such as `db/cms/pages.schema.jsonc`.              | Group generated form fields by fixture folder, show edit-source links, or debug CMS metadata. |
| `sourceFile`      | Absolute source file path.                                               | Integrate with local tooling that needs an absolute path.                                     |
| `field`           | Normalized jsondb field schema.                                          | Branch on schema facts such as `type`, `relation`, `values`, or constraints.                 |
| `resource`        | Normalized resource metadata.                                            | Inspect kind, id field, relations, or source metadata for broader resource-level rules.       |
| `defaultManifest` | The JSON-serializable manifest jsondb would emit without customization. | Preserve defaults while overriding only the app-specific UI metadata you care about.          |

Return `defaultManifest` to keep a field unchanged, return a modified copy to add app metadata, or return `null` to omit the field from the manifest. Returned values must be JSON-serializable.

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
