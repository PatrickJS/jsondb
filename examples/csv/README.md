# CSV Example

This example starts from CSV fixture files. jsondb scans the header row, infers field shapes from the rows, generates types, and mirrors the data into `.jsondb/state/*.json`.

Run from the repository root:

```bash
node ./src/cli.js sync --cwd ./examples/csv
node ./src/cli.js serve --cwd ./examples/csv
```

When `db/customers.csv` changes, `jsondb sync` detects the source hash change and refreshes the runtime JSON mirror from the CSV.
