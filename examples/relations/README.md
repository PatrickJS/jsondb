# Relations Example

## What This Teaches

Use this when local fixtures need related records but you still want plain ids in JSON. It demonstrates to-one relation metadata, explicit REST `expand`, and nested `select`.

## Files To Inspect

- `db/users.schema.jsonc`: target collection.
- `db/posts.schema.jsonc`: `authorId` declares a relation to `users.id`.
- `jsondb.config.mjs`: default mirror setup using `defineConfig`.

## Run It

From the repository root:

```bash
node ./src/cli.js sync --cwd ./examples/relations
node ./src/cli.js serve --cwd ./examples/relations
```

Open the viewer:

```txt
http://127.0.0.1:7331/__jsondb
```

## Expected Result

The viewer lists `posts` and `users`. The posts schema shows an `author` relation derived from `authorId`.

## REST Request To Try

```bash
curl 'http://127.0.0.1:7331/posts?expand=author&select=id,title,author.name'
```

Relation expansion is intentionally explicit and depth 1 in this version.

## Cleanup

Generated `.jsondb/` output is ignored by git and can be removed whenever you want a fresh mirror.
