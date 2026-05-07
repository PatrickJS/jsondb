import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeText } from './fs-utils.js';

const writeQueues = new Map();

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

export function withJsonStateWrite(filePath, operation) {
  const previous = writeQueues.get(filePath) ?? Promise.resolve();
  const current = previous.then(operation, operation);
  const stored = current.catch(() => {});
  writeQueues.set(filePath, stored);

  stored.finally(() => {
    if (writeQueues.get(filePath) === stored) {
      writeQueues.delete(filePath);
    }
  });

  return current;
}
