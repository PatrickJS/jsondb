import path from 'node:path';
import { defaultGeneratorRegistry } from '../../features/generate/registry.js';

export async function runGenerate(config, args) {
  const target = args[0];
  const registry = defaultGeneratorRegistry();
  const generator = registry.get(target);
  if (!generator) {
    throw new Error(`Usage: ${registry.usage()}`);
  }

  const result = await generator.run(config, args.slice(1));

  for (const filePath of result.files) {
    console.log(`Generated ${path.relative(config.cwd, filePath)}`);
  }
}
