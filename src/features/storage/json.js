import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyDefaultsToSeed } from '../sync/defaults.js';
import { seedForRuntimeState } from '../sync/synthetic-seed.js';
import { updateSourceMetadataResource } from './source-metadata.js';

const writeQueues = new Map();

export const jsonRuntimeCapabilities = {
  writable: true,
  persistence: 'local-file',
  atomicity: 'resource',
  liveEvents: true,
  staticExport: false,
  production: 'small-local',
};

export function createJsonRuntimeAdapter(config) {
  return {
    name: 'json',
    capabilities: jsonRuntimeCapabilities,
    statePath(resource) {
      return statePathForResource(config, resource.name);
    },
    async hydrate(resources) {
      await mkdir(path.join(config.stateDir, 'state'), { recursive: true });
      const sourceMetadataPath = path.join(config.stateDir, 'state', '.sources.json');
      const sourceMetadata = await readJsonState(sourceMetadataPath, { resources: {} });
      sourceMetadata.resources ??= {};

      for (const resource of resources) {
        await syncJsonResourceState(config, resource, sourceMetadata);
      }
      await writeJsonState(sourceMetadataPath, sourceMetadata);
    },
    readResource(resource, fallback) {
      return readJsonState(statePathForResource(config, resource.name), fallback);
    },
    writeResource(resource, value) {
      return writeJsonState(statePathForResource(config, resource.name), value);
    },
    withResourceWrite(resource, operation) {
      return withJsonStateWrite(statePathForResource(config, resource.name), operation);
    },
  };
}

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
  return atomicWriteJson(filePath, value);
}

export async function atomicWriteJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const text = `${JSON.stringify(value, null, 2)}\n`;
  try {
    if ((await readFile(filePath, 'utf8')) === text) {
      return false;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
  );

  try {
    await writeFile(tempPath, text, 'utf8');
    await rename(tempPath, filePath);
    return true;
  } catch (error) {
    try {
      await rm(tempPath, { force: true });
    } catch {
      // Best-effort cleanup only.
    }
    throw error;
  }
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

export async function syncJsonResourceState(config, resource, sourceMetadata) {
  const statePath = statePathForResource(config, resource.name);
  const existing = await readJsonState(statePath, undefined);
  const metadata = sourceMetadata.resources[resource.name];
  const sourceChanged = resource.dataHash
    && metadata?.hash !== resource.dataHash;

  if (existing === undefined || sourceChanged) {
    await writeJsonState(statePath, applyDefaultsToSeed(seedForRuntimeState(resource, config), resource, config));
    updateSourceMetadata(sourceMetadata, config, resource);
    return;
  }

  if (config.defaults?.applyOnSafeMigration !== false) {
    await writeJsonState(statePath, applyDefaultsToSeed(existing, resource, config));
  }

  updateSourceMetadata(sourceMetadata, config, resource);
}

function updateSourceMetadata(sourceMetadata, config, resource) {
  updateSourceMetadataResource(sourceMetadata, config, resource);
}
