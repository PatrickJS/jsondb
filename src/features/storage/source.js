import { jsonDbError } from '../../errors.js';
import { applyDefaultsToSeed } from '../sync/defaults.js';
import { seedForRuntimeState } from '../sync/synthetic-seed.js';
import { atomicWriteJson, readJsonState, withJsonStateWrite } from './json.js';

export const sourceRuntimeCapabilities = {
  writable: true,
  persistence: 'source-file',
  atomicity: 'resource',
  liveEvents: true,
  staticExport: false,
  production: false,
};

export function createSourceRuntimeAdapter(config) {
  const fallbacks = new Map();

  return {
    name: 'source',
    capabilities: sourceRuntimeCapabilities,
    async hydrate(resources) {
      for (const resource of resources) {
        assertWritableSource(resource);
        fallbacks.set(resource.name, structuredClone(applyDefaultsToSeed(seedForRuntimeState(resource, config), resource, config)));
      }
    },
    readResource(resource, fallback) {
      assertWritableSource(resource);
      return readJsonState(resource.dataPath, fallbacks.has(resource.name) ? structuredClone(fallbacks.get(resource.name)) : fallback);
    },
    writeResource(resource, value) {
      assertWritableSource(resource);
      return atomicWriteJson(resource.dataPath, value);
    },
    withResourceWrite(resource, operation) {
      assertWritableSource(resource);
      return withJsonStateWrite(resource.dataPath, operation);
    },
  };
}

export async function writeSourceMetadata(config, resources, sourceMetadata) {
  for (const resource of resources) {
    updateSourceMetadata(sourceMetadata, config, resource);
  }
}

function assertWritableSource(resource) {
  if (resource.dataPath && resource.dataFormat === 'json') {
    return;
  }

  throw jsonDbError(
    'RUNTIME_SOURCE_NOT_WRITABLE',
    `Resource "${resource.name}" cannot use the source runtime because it is not backed by a plain JSON data file.`,
    {
      status: 400,
      hint: 'Use runtime "source" only for resources loaded from db/*.json data files.',
      details: {
        resource: resource.name,
        dataFormat: resource.dataFormat,
        dataPath: resource.dataPath,
      },
    },
  );
}

function updateSourceMetadata(sourceMetadata, config, resource) {
  if (!resource.dataHash) {
    return;
  }

  sourceMetadata.resources[resource.name] = {
    path: resource.dataPath ? relativePath(config, resource.dataPath) : null,
    format: resource.dataFormat,
    hash: resource.dataHash,
    updatedAt: new Date().toISOString(),
  };
}

function relativePath(config, filePath) {
  return filePath.startsWith(config.cwd) ? filePath.slice(config.cwd.length + 1).split('\\').join('/') : filePath;
}
