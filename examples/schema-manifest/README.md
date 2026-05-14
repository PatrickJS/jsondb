# Schema Manifest Example

## What This Teaches

Use this when an app wants committed schema metadata for admin, CMS, or form-building screens. It demonstrates `schemaOutFile` and `schemaManifest.customizeField()`.

## Files To Inspect

- `db/projects.schema.jsonc`: relation, enum, defaults, and descriptions.
- `db/users.schema.jsonc`: field descriptions and a `bio` field customized for markdown.
- `jsondb.config.mjs`: writes `src/generated/jsondb.schema.json` and customizes UI hints.
- `src/generated/jsondb.schema.json`: committed manifest output after sync.

## Run It

From the repository root:

```bash
node ./src/cli.js sync --cwd ./examples/schema-manifest
node ./src/cli.js schema manifest --cwd ./examples/schema-manifest --out ./src/generated/jsondb.schema.json
node ./src/cli.js serve --cwd ./examples/schema-manifest
```

## Expected Result

`sync` writes both generated TypeScript types and a committed schema manifest. In the manifest, `projects.status` uses `segmented-control`, and `users.bio` uses `markdown`.

## REST Request To Try

```bash
curl 'http://127.0.0.1:7331/projects?expand=owner&select=id,name,status,owner.name'
```

## Cleanup

Generated `.jsondb/` output is ignored by git. The files under `src/generated/` are intentionally committed for this example.
