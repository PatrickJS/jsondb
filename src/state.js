import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeText } from './fs-utils.js';

export function statePathForResource(config, resourceName) {
  return path.join(config.stateDir, 'state', `${resourceName}.json`);
}

export async function readJsonState(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

export async function writeJsonState(filePath, value) {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
