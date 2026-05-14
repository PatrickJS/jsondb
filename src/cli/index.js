import { loadConfig } from '../config.js';
import { parseGlobalOptions } from './args.js';
import { runCreate } from './commands/create.js';
import { runDoctor } from './commands/doctor.js';
import { runGenerate } from './commands/generate.js';
import { runSchema } from './commands/schema.js';
import { runServe } from './commands/serve.js';
import { runSync } from './commands/sync.js';
import { runTypes } from './commands/types.js';
import { printDiagnostic, printHelp } from './output.js';

export async function main(args = process.argv.slice(2)) {
  const command = args[0] ?? 'help';

  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === '--version' || command === '-v') {
    console.log('0.1.0');
    return;
  }

  const config = await loadConfig(parseGlobalOptions(args));

  switch (command) {
    case 'sync':
      await runSync(config);
      break;
    case 'types':
      await runTypes(config, args.slice(1));
      break;
    case 'schema':
      await runSchema(config, args.slice(1));
      break;
    case 'doctor':
    case 'check':
      await runDoctor(config, args.slice(1));
      break;
    case 'create':
      await runCreate(config, args.slice(1));
      break;
    case 'serve':
      await runServe(config, args.slice(1));
      break;
    case 'generate':
      await runGenerate(config, args.slice(1));
      break;
    default:
      throw new Error(`Unknown command "${command}". Run "jsondb help".`);
  }
}

export function runCli(args = process.argv.slice(2)) {
  main(args).catch((error) => {
    if (error.diagnostics) {
      for (const diagnostic of error.diagnostics) {
        printDiagnostic(diagnostic);
      }
    }

    console.error(error.message);
    process.exitCode = 1;
  });
}
