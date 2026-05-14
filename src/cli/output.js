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
