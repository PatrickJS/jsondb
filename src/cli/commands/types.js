import { watch } from 'node:fs';
import path from 'node:path';
import { loadProjectSchema } from '../../schema.js';
import { generateTypes } from '../../types.js';
import { valueAfter } from '../args.js';
import { printDiagnostic } from '../output.js';

export async function runTypes(config, args) {
  if (args.includes('--watch')) {
    await runTypesOnce(config, args);
    console.log(`Watching ${path.relative(config.cwd, config.sourceDir) || '.'}`);
    watch(config.sourceDir, { recursive: true }, async () => {
      try {
        await runTypesOnce(config, args);
      } catch (error) {
        console.error(error.message);
      }
    });
    return new Promise(() => {});
  }

  await runTypesOnce(config, args);
}

async function runTypesOnce(config, args) {
  const outFile = valueAfter(args, '--out');
  const project = await loadProjectSchema(config);
  const result = await generateTypes(config, { project, outFile });

  for (const diagnostic of result.diagnostics) {
    printDiagnostic(diagnostic);
  }

  for (const filePath of result.outFiles) {
    console.log(`Generated ${path.relative(config.cwd, filePath)}`);
  }
}
