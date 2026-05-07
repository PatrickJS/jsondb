# Repository Guide For AI Agents

## Project Shape

This repo is a dependency-light Node.js ESM package named `json-fixture-db`.

Core responsibilities:

- Load fixture data from `db/*.json` and `db/*.jsonc`.
- Load schema sources from `db/*.schema.jsonc` and `db/*.schema.mjs`.
- Infer schemas from data-first fixtures.
- Generate TypeScript types.
- Sync a writable runtime mirror into `.jsondb/state`.
- Expose a package API, CLI, and small local REST server.

Important files:

- `SPEC.md`: product behavior and acceptance criteria.
- `src/cli.js`: `jsondb` command implementation.
- `src/schema.js`: source discovery, schema loading, inference, diagnostics, REST/GraphQL metadata.
- `src/types.js`: TypeScript type generation.
- `src/sync.js`: generated schema/types and runtime mirror sync.
- `src/db.js`: package runtime API.
- `src/server.js`: dependency-free local HTTP server.
- `src/schema-builders.js`: `.schema.mjs` authoring helpers exported as `json-fixture-db/schema`.
- `test/jsondb.test.js`: Node test runner suite.
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
- Keep schema source support focused on `.json`, `.jsonc`, `.schema.jsonc`, and `.schema.mjs`.
- Do not add TypeScript schema execution in v1 without adding an explicit loader/build story.
- Schema files are authoritative in mixed mode; data files provide seed records.
- Default local behavior for unknown fields is warning, with strict mode available through `schema.unknownFields: 'error'`.
- Defaults should apply on create and safe additive mirror sync unless config disables them.
- Field `description` values should feed generated TypeScript JSDoc and GraphQL SDL descriptions.

## Testing Guidance

Use `node:test` and temporary project directories under the system temp directory. Tests should create their own `db/` fixtures and avoid depending on generated repo state.

When testing `.schema.mjs`, symlink this repo into the temp project's `node_modules/json-fixture-db` so package self-imports behave like a consumer install.

Add tests for every behavior change that touches:

- fixture discovery
- schema inference
- mixed-mode diagnostics
- generated types
- defaults
- CLI path handling
- runtime collection/document APIs
- server routes

## GitHub Actions

CI lives in `.github/workflows/ci.yml` and runs on Node.js 20, 22, and 24:

- `npm run check`
- `npm test`
- `npm pack --dry-run`

Dependabot is configured in `.github/dependabot.yml` for GitHub Actions updates.
