export function printDiagnostic(diagnostic) {
  const prefix = diagnostic.severity === 'error' ? 'error' : 'warn';
  console.error(`${prefix}: ${diagnostic.message}`);
}

export function printDoctorResult(result) {
  if (result.findings.length === 0) {
    console.log('jsondb doctor found no issues');
    return;
  }

  console.log(`jsondb doctor found ${result.findings.length} finding${result.findings.length === 1 ? '' : 's'}`);
  for (const finding of result.findings) {
    console.log(`${finding.severity}: ${finding.code}: ${finding.message}`);
    if (finding.hint) {
      console.log(`  hint: ${finding.hint}`);
    }
  }
}

export function printHelp() {
  console.log(`jsondb

Usage:
  jsondb sync
  jsondb types [--watch] [--out <file>]
  jsondb schema [resource]
  jsondb schema infer [resource] [--out <file>]
  jsondb schema unbundle <resource> [--schema-out <file>] [--seed-out <file>] [--empty-seed] [--force]
  jsondb schema bundle <resource> [--out <file>] [--force]
  jsondb schema manifest [--out <file>]
  jsondb schema validate
  jsondb doctor [--strict] [--json]
  jsondb check [--strict] [--json]
  jsondb create <collection> <json>
  jsondb serve [--host <host>] [--port <port>]
  jsondb generate hono [--out <dir>] [--api <targets>] [--app <shape>]

Options:
  --cwd <dir>       Project directory
  --config <file>   Config file path
`);
}

export function printTypesHelp() {
  console.log(`jsondb types

Usage:
  jsondb types [--watch] [--out <file>]

Options:
  --watch        Regenerate types when fixture sources change
  --out <file>   Write generated types to this path
  --cwd <dir>     Project directory
  --config <file> Config file path
`);
}

export function printSchemaHelp() {
  console.log(`jsondb schema

Usage:
  jsondb schema [resource]
  jsondb schema infer [resource] [--out <file>]
  jsondb schema unbundle <resource> [--schema-out <file>] [--seed-out <file>] [--empty-seed] [--force]
  jsondb schema bundle <resource> [--out <file>] [--force]
  jsondb schema manifest [--out <file>]
  jsondb schema validate

Options:
  --out <file>        Write schema manifest, inferred schema, or bundled schema output to this path
  --schema-out <file> Write unbundled schema output to this path
  --seed-out <file>   Write unbundled seed output to this path
  --empty-seed        Write an empty seed fixture when unbundling schema-only resources
  --force             Allow overwriting outputs or writing bundle output inside db/
  --cwd <dir>     Project directory
  --config <file> Config file path
`);
}

export function printDoctorHelp() {
  console.log(`jsondb doctor

Usage:
  jsondb doctor [--strict] [--json]
  jsondb check [--strict] [--json]

Options:
  --strict       Exit with an error when warnings are present
  --json         Print machine-readable findings
  --cwd <dir>     Project directory
  --config <file> Config file path
`);
}

export function printServeHelp() {
  console.log(`jsondb serve

Usage:
  jsondb serve [--host <host>] [--port <port>]

Options:
  --host <host>  Host to bind, defaulting to configured server.host
  --port <port>  Port to bind, defaulting to configured server.port
  --cwd <dir>     Project directory
  --config <file> Config file path
`);
}

export function printGenerateHelp(usage) {
  console.log(`jsondb generate

Usage:
  ${usage}

Options:
  --cwd <dir>     Project directory
  --config <file> Config file path
`);
}
