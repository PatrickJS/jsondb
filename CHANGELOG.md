# Changelog

This project does not have versioned releases yet. Until releases start, this file
tracks the repository history by feature area from the first commit onward.

Dates are commit dates from the git history. Commit links point at the canonical
GitHub repository: <https://github.com/PatrickJS/jsondb>.

## Feature History

### Project Foundation

- 2026-05-07 - Created the dependency-light Node.js ESM package with JSON/JSONC fixture loading, schema helpers, runtime mirror sync, generated TypeScript types, a CLI, and the basic example project. Commit [4ee9630](https://github.com/PatrickJS/jsondb/commit/4ee9630d84739f738eb8d6add2deb311ad725303).
- 2026-05-07 - Added CI, Dependabot, repository agent guidance, and the package check script. Commit [1d9600c](https://github.com/PatrickJS/jsondb/commit/1d9600cec0ea4a994436ce315e7ab9bb553bf9ce).
- 2026-05-07 - Clarified the basic README instructions for `db/users.json`. Commit [836aade](https://github.com/PatrickJS/jsondb/commit/836aade4dae66119983d06545fe003b5b549f2fb).

### Runtime API, REST, and Server

- 2026-05-07 - Added the REST runtime, GraphQL runtime, GraphQL parser, HTTP handlers, and protocol tests. Commit [d24dd9a](https://github.com/PatrickJS/jsondb/commit/d24dd9adb0a33e85d29dc921b9c055bfc644c31c).
- 2026-05-07 - Added structured `JsonDbError` handling for clearer API and server failures. Commit [f25659e](https://github.com/PatrickJS/jsondb/commit/f25659e66ff19f2fd0a32653784fbeef9994dad9).
- 2026-05-07 - Added schema-backed validation, request body limits, and safer batching behavior. Commit [af60a9c](https://github.com/PatrickJS/jsondb/commit/af60a9c4a98514aef1f56cb70530db7d15777dbf).
- 2026-05-11 - Renamed the package-facing API to `jsondb` and added an embeddable request handler for mounting jsondb into other servers. Commit [0b7f9d5](https://github.com/PatrickJS/jsondb/commit/0b7f9d51519f9f14fb8e9d97abb90a5ea062a96a).

### Client, Viewer, Examples, and Mocking

- 2026-05-07 - Added the HTTP client, automatic and direct batching, example projects, built-in viewer, and mock behavior tests. Commit [d8373b1](https://github.com/PatrickJS/jsondb/commit/d8373b16bf3b7d7aa7f1155b406b7082809c672c).
- 2026-05-07 - Added live reload, generated collection ids, source diagnostics, and viewer updates for broken source files. Commit [7e4cce7](https://github.com/PatrickJS/jsondb/commit/7e4cce7d9abc57cb68464add8aac0c8da5b14e2a).

### CSV Fixtures and Import

- 2026-05-07 - Added CSV fixture loading, CSV examples, viewer CSV import, and CSV-backed sync support. Commit [6312e0b](https://github.com/PatrickJS/jsondb/commit/6312e0bb4cccddbb2f264367dbfb6c5677dc9acb).
- 2026-05-11 - Added CSV array coercion for schema-backed CSV fixtures, including semicolon-delimited and JSON array string cells. Commit [28bf08b](https://github.com/PatrickJS/jsondb/commit/28bf08b2d3fa014180c0d6128159f358340e12c1).

### Schema Sources, Types, and Validation

- 2026-05-07 - Added `.schema.json` support and synthetic seed generation for schema-first resources. Commit [03a5da9](https://github.com/PatrickJS/jsondb/commit/03a5da95394177b3e7f714d0fd1abb2c103f84a9).
- 2026-05-11 - Added nullable fields, datetime fields, schema builder updates, and generated type support for those field shapes. Commit [28bf08b](https://github.com/PatrickJS/jsondb/commit/28bf08b2d3fa014180c0d6128159f358340e12c1).
- 2026-05-11 - Added field constraints and unique-field validation across sync, package API writes, REST writes, GraphQL mutations, and schema validation. Commit [d38aa6b](https://github.com/PatrickJS/jsondb/commit/d38aa6b3cc92018feb1818a34803c5bc8805cb21).

### Configuration

- 2026-05-11 - Added configurable fixture directories with `dbDir`, while preserving `sourceDir` compatibility. Commit [d5371c8](https://github.com/PatrickJS/jsondb/commit/d5371c824d061e0bde11e8d9549dae7cc6709e9f).
- 2026-05-11 - Added `defineConfig`, config typings, the example config file, and expanded README configuration guidance. Commit [15f559b](https://github.com/PatrickJS/jsondb/commit/15f559b42ba319c3d4ebf166ced04c73737eaadb).

### REST Shaping and Relations

- 2026-05-11 - Added REST response shaping with `select`, `offset`, and `limit`; added explicit depth-1 to-one relation metadata and `expand` support. Commit [d9f7c70](https://github.com/PatrickJS/jsondb/commit/d9f7c7026d943a78ddf64688173e3c00089c6287).

### GraphQL

- 2026-05-11 - Added GraphQL `operationName` selection, named fragments, inline fragments, `@include`, `@skip`, `__typename`, and minimal `__schema` / `__type` introspection. Commit [f196625](https://github.com/PatrickJS/jsondb/commit/f196625f2eb6c57d03565b35b0bdb7cafcb26efb).

### Doctor and Fixture Diagnostics

- 2026-05-11 - Added `jsondb doctor` / `jsondb check`, JSON output, strict mode, fixture diagnostics, relation suggestions, and fork health checks. Commit [22cb816](https://github.com/PatrickJS/jsondb/commit/22cb8168daaa8779893e175ea23906e12a8f41fc).
- 2026-05-11 - Documented the `doctor` CLI health check behavior in the product spec. Commit [bf29064](https://github.com/PatrickJS/jsondb/commit/bf2906458c944b18fa4a57f6de02ef9aacb3f153).
- 2026-05-11 - Merged the shape-layer MVP branch containing the Vite plugin, REST shaping, relation support, and doctor work. Commit [bea5776](https://github.com/PatrickJS/jsondb/commit/bea5776816b6e20f65750e331e3b6330b59c7e51).

### Vite Integration

- 2026-05-11 - Added the dependency-light Vite dev-server plugin, scoped `/__jsondb` routes, optional root REST routes, and the `virtual:jsondb/client` module. Commit [d9f7c70](https://github.com/PatrickJS/jsondb/commit/d9f7c7026d943a78ddf64688173e3c00089c6287).

### Database Forks

- 2026-05-11 - Added configured database forks with separate fixture folders, fork-scoped runtime state, fork-aware clients, fork-scoped HTTP routes, Vite helpers, and diagnostics. Commit [1873c67](https://github.com/PatrickJS/jsondb/commit/1873c6724b93137fbf736fb8f2310444dfe4b088).

### Schema Manifest

- 2026-05-11 - Added committed schema manifest generation for model-driven admin/CMS UIs, including `schemaOutFile`, `jsondb schema manifest`, manifest render helpers, field UI hints, and customization hooks. Commit [7a2e819](https://github.com/PatrickJS/jsondb/commit/7a2e8197ec0d5f0dc391e17ed429693e80147d10).
- 2026-05-11 - Landed the schema manifest work through PR #5. Commit [11a2d8d](https://github.com/PatrickJS/jsondb/commit/11a2d8d31c97844d59d2ea7088fcd1ea0b40b686).

### Hono and SQLite Graduation Path

- 2026-05-07 - Added the Hono and SQLite starter generator, optional Hono integration, optional SQLite adapter, generation CLI, and related tests. Commit [4e4770e](https://github.com/PatrickJS/jsondb/commit/4e4770e71eb376a524562c2a739c2a41bc40b9ac).

### Maintenance

- 2026-05-07 - Ignored the temporary folder in git. Commit [ad4e52a](https://github.com/PatrickJS/jsondb/commit/ad4e52aac9ba2dc39eb320ec4262d660dfb7f2c3).
- 2026-05-11 - Bumped `actions/setup-node` from v4 to v6. Commit [d4b23e4](https://github.com/PatrickJS/jsondb/commit/d4b23e4dd614c9367e4dbb512755124384fb5918).
- 2026-05-11 - Bumped `actions/checkout` from v4 to v6. Commit [7dffcc0](https://github.com/PatrickJS/jsondb/commit/7dffcc0c70d5173fddf07ac23737a22dcabb9e49).
- 2026-05-11 - Added the initial feature-history changelog. Commit [1611bde](https://github.com/PatrickJS/jsondb/commit/1611bde01d3f972a7bb9cae55e9e3f12bb46f45a).
