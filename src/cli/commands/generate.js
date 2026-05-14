import path from 'node:path';
import { defaultGeneratorRegistry } from '../../features/generate/registry.js';
import { isHelpRequested } from '../args.js';
import { printGenerateHelp } from '../output.js';

export async function runGenerate(config, args) {
  const target = args[0];
  const registry = defaultGeneratorRegistry();
  if (isHelpRequested(args) && (!target || target.startsWith('-'))) {
    printGenerateHelp(registry.usage());
    return;
  }

  const generator = registry.get(target);
  if (!generator) {
    throw new Error(`Usage: ${registry.usage()}`);
  }

  if (isHelpRequested(args.slice(1))) {
    printGenerateHelp(generator.usage);
    return;
  }

  const result = await generator.run(config, args.slice(1));

  for (const filePath of result.files) {
    console.log(`Generated ${path.relative(config.cwd, filePath)}`);
  }
}
