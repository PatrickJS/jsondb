# jsondb Architecture

jsondb is a dependency-light Node.js ESM package. The default path is intentionally small: fixture files become generated schema metadata, TypeScript types, runtime JSON state, and local REST/viewer routes.

## Main Flow

```txt
db/*.json, *.jsonc, *.csv, *.schema.json(c), *.schema.mjs
  -> source readers
  -> resource schemas and diagnostics
  -> sync output
  -> .jsondb/schema.generated.json
  -> .jsondb/types/index.ts and optional committed generated files
  -> .jsondb/state/*.json runtime mirror
  -> package API, REST, GraphQL, viewer, client, and generators
```

## Core Boundaries

- Source discovery and loading live under `src/features/schema/sources.js`. Built-in readers handle JSON, JSONC, CSV, and schema files; custom readers normalize into the same data/schema source shape.
- Resource construction, field inference, relations, and validation live under `src/features/schema/`. Schema files are authoritative in mixed mode, while data files provide seed records.
- Sync lives under `src/features/sync/`. It writes generated schema, generated types, optional schema manifests, source metadata, and the runtime mirror.
- Runtime storage lives under `src/features/storage/` and `src/features/runtime/`. The default runtime is the JSON mirror; memory, static, source-backed, SQLite, and future adapters fit behind the runtime boundary.
- HTTP serving starts in `src/server.js`. REST routing lives in `src/rest/`, GraphQL lives in `src/graphql/`, and built-in viewer HTML/JS lives in `src/web/`.
- Optional graduation paths are separate from the core: Hono/SQLite starter generation lives in `src/generate/hono.js` and `src/generate/hono/`; optional integrations live in `src/integrations/`.

## Local Trust Model

- `jsondb serve` binds to `127.0.0.1` by default and is intended for local development.
- `.schema.mjs` files execute as local project JavaScript. Treat them like source code, not untrusted data.
- The viewer CSV import endpoint writes CSV files into the configured `dbDir`.
- `mode: 'mirror'` keeps source fixtures clean and writes app changes to `.jsondb/state`.
- `mode: 'source'` may write generated ids back to plain `.json` source fixtures when configured intentionally.
- `.jsondb/` is generated runtime output and should normally stay uncommitted.
