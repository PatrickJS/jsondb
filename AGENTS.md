# Repository Guide For AI Agents

## Project Shape

This repo is a dependency-light Node.js ESM package named `jsondb`.

Core responsibilities:

- Load fixture data from `db/*.json`, `db/*.jsonc`, and `db/*.csv`.
- Load schema sources from `db/*.schema.json`, `db/*.schema.jsonc`, and `db/*.schema.mjs`.
- Infer schemas from data-first fixtures.
- Generate TypeScript types.
- Sync a writable runtime mirror into `.jsondb/state`, using source hashes for JSON/JSONC/CSV refreshes.
- Expose a package API, CLI, and small local REST server.

Important files:

- `SPEC.md`: product behavior and acceptance criteria.
- `src/cli.js`: `jsondb` command implementation.
- `src/schema.js`: source discovery, schema loading, inference, diagnostics, REST/GraphQL metadata.
- `src/types.js`: TypeScript type generation.
- `src/sync.js`: generated schema/types and runtime mirror sync.
- `src/db.js`: package runtime API.
- `src/server.js`: dependency-free local HTTP server entry point.
- `src/rest`: REST request routing and HTTP helpers.
- `src/graphql`: dependency-free GraphQL subset parser, executor, and HTTP handler.
- `src/web`: dependency-free built-in viewer served at `/__jsondb`.
- `src/generate/hono.js`: Hono/SQLite starter code generator.
- `src/hono.js`: optional Hono integration using dynamic `hono` import.
- `src/sqlite.js`: optional SQLite adapter using dynamic `node:sqlite` import.
- `src/client.js`: tiny HTTP client with GraphQL and REST batching support.
- `scripts/serve-examples.js`: starts every repo example and serves an index of viewer links.
- `src/schema-builders.js`: `.schema.mjs` authoring helpers exported as `jsondb/schema`.
- `test/jsondb.test.js`: general Node test runner suite.
- `test/helpers.js`: shared test project helpers.
- `src/**/*.test.js`: co-located protocol/module tests.
- `examples/basic`: smoke-testable example project.

## Commands

Run these before handing off changes:

```bash
npm run check
npm test
npm pack --dry-run
```

Useful CLI smoke checks:

```bash
node ./src/cli.js sync --cwd ./examples/basic
node ./src/cli.js schema validate --cwd ./examples/basic
node ./src/cli.js create users '{"id":"u_2","name":"Grace Hopper","email":"grace@example.com"}' --cwd ./examples/basic
npm run examples
```

The local REST server binds a loopback port. In sandboxed environments this may require explicit approval:

```bash
node ./src/cli.js serve --cwd ./examples/basic
```

## Generated Files

`.jsondb/` is generated runtime output and should normally stay uncommitted.

Committed generated types are allowed when configured through `types.commitOutFile`. The example intentionally includes:

```txt
examples/basic/src/generated/jsondb.types.ts
```

If a smoke command writes `.jsondb/` inside `examples/basic`, remove those generated files before finalizing unless the task explicitly asks to commit generated runtime state.

## Implementation Rules

- Keep the package ESM and dependency-light. Prefer Node standard library APIs unless a feature clearly needs a dependency.
- Preserve support for Node.js 20 and newer.
- Keep schema source support focused on `.json`, `.jsonc`, `.csv`, `.schema.json`, `.schema.jsonc`, and `.schema.mjs`.
- Do not add TypeScript schema execution in v1 without adding an explicit loader/build story.
- Schema files are authoritative in mixed mode; data files provide seed records.
- Default local behavior for unknown fields is warning, with strict mode available through `schema.unknownFields: 'error'`.
- Defaults should apply on create and safe additive mirror sync unless config disables them.
- Field `description` values should feed generated TypeScript JSDoc and GraphQL SDL descriptions.
- Collection fixtures without `id` should receive counter ids in the runtime mirror. Default mirror mode must not rewrite source files; `mode: 'source'` may write generated ids back to plain `.json` fixtures.
- `jsondb serve` watches `db/` for source changes, ignores `.jsondb/`, reloads valid resources, and surfaces file-specific diagnostics in the viewer without breaking unrelated resources.
- Keep Hono and SQLite optional. Do not add mandatory package dependencies for `hono`, `@hono/node-server`, or SQLite libraries; generated starters may declare their own dependencies.
- `jsondb generate hono` should fail on schema errors and block warning diagnostics unless explicitly allowed with `--allow-warnings`.

## Testing Guidance

Use `node:test` and temporary project directories under the system temp directory. Tests should create their own `db/` fixtures and avoid depending on generated repo state.

Put broad package behavior in `test/*.test.js`. Put protocol-specific tests next to their implementation, such as `src/graphql/graphql.test.js` and `src/rest/handler.test.js`.

When testing `.schema.mjs`, symlink this repo into the temp project's `node_modules/jsondb` so package self-imports behave like a consumer install.

Add tests for every behavior change that touches:

- fixture discovery
- schema inference
- mixed-mode diagnostics
- generated types
- defaults
- CLI path handling
- Hono/SQLite starter generation output shape
- optional SQLite behavior, gated when `node:sqlite` is unavailable
- runtime collection/document APIs
- server routes
- GraphQL parser/executor behavior, especially aliases, variables, and mutations
- GraphQL and REST batching behavior
- client direct and automatic batching behavior, including 10ms default windows and dedupe
- mock delay/error behavior
- error messages; assert code, human message, hint, and useful details for new failure modes
- built-in viewer behavior and generated examples

## GitHub Actions

CI lives in `.github/workflows/ci.yml` and runs on Node.js 20, 22, and 24:

- `npm run check`
- `npm test`
- `npm pack --dry-run`

Dependabot is configured in `.github/dependabot.yml` for GitHub Actions updates.
