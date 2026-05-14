import { createHash } from 'node:crypto';
import path from 'node:path';
import { writeText } from '../../fs-utils.js';

export async function writeGeneratedIdsToSources(config, resources, logs) {
  if (config.mode === 'mirror') {
    return;
  }

  for (const resource of resources) {
    if (!resource.generatedIds || resource.dataFormat !== 'json' || !resource.dataPath) {
      continue;
    }

    const text = `${JSON.stringify(resource.seed, null, 2)}\n`;
    await writeText(resource.dataPath, text);
    resource.dataHash = createHash('sha256').update(text).digest('hex');
    resource.generatedIds = false;
    logs.push(`Updated ${path.relative(config.cwd, resource.dataPath)} with generated ids`);
  }
}
