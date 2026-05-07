# Diagnostics Example

This example intentionally includes schema/data mismatches so the `/__jsondb` viewer can show source diagnostics while valid resources still work.

Run from the repository root:

```bash
node ./src/cli.js sync --cwd ./examples/diagnostics
node ./src/cli.js serve --cwd ./examples/diagnostics
```

Expected diagnostics include an extra `twitterHandle` field in `users.json` and an undefined nested `metadata.priority` field in `projects.schema.jsonc`.
