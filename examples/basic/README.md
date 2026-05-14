# Basic Example

## What This Teaches

Start here when you want the smallest schema-backed jsondb workflow. It demonstrates sync, committed generated types, the viewer, and creating a record.

## Files To Inspect

- `db/users.schema.jsonc`: schema-backed collection with seed data.
- `db/settings.json`: singleton document inferred from data.
- `src/generated/jsondb.types.ts`: committed generated types.

## Run It

From the repository root:

```bash
node ./src/cli.js sync --cwd ./examples/basic
node ./src/cli.js serve --cwd ./examples/basic
```

Open the viewer:

```txt
http://127.0.0.1:7331/__jsondb
```

## Expected Result

`sync` writes generated schema, types, and runtime state under `examples/basic/.jsondb/`, plus the committed type copy in `src/generated/`.

## REST Request To Try

```bash
curl -X POST http://127.0.0.1:7331/users \
  -H 'content-type: application/json' \
  -d '{"id":"u_2","name":"Grace Hopper","email":"grace@example.com"}'
```

The equivalent CLI smoke command is:

```bash
node ./src/cli.js create users '{"id":"u_2","name":"Grace Hopper","email":"grace@example.com"}' --cwd ./examples/basic
```

## Cleanup

Generated `.jsondb/` output is ignored by git and can be removed whenever you want a fresh mirror.
