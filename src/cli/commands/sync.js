import { syncJsonFixtureDb } from '../../sync.js';
import { printDiagnostic } from '../output.js';

export async function runSync(config) {
  const result = await syncJsonFixtureDb(config);
  for (const diagnostic of result.diagnostics) {
    printDiagnostic(diagnostic);
  }
  for (const line of result.logs) {
    console.log(line);
  }
}
