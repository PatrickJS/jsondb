import path from 'node:path';
import { readJsonState, statePathForResource, writeJsonState } from '../runtime/state.js';
import { applyDefaultsToSeed } from './defaults.js';
import { seedForRuntimeState } from './synthetic-seed.js';

export async function syncStateResource(config, resource, sourceMetadata) {
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
  if (!resource.dataHash) {
    return;
  }

  sourceMetadata.resources[resource.name] = {
    path: path.relative(config.cwd, resource.dataPath),
    format: resource.dataFormat,
    hash: resource.dataHash,
    updatedAt: new Date().toISOString(),
  };
}
