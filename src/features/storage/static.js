import { jsonDbError } from '../../errors.js';
import { applyDefaultsToSeed } from '../sync/defaults.js';
import { seedForRuntimeState } from '../sync/synthetic-seed.js';

export const staticRuntimeCapabilities = {
  writable: false,
  persistence: 'static',
  atomicity: 'none',
  liveEvents: false,
  staticExport: true,
  production: true,
};

export function createStaticRuntimeAdapter(config) {
  const values = new Map();

  return {
    name: 'static',
    capabilities: staticRuntimeCapabilities,
    async hydrate(resources) {
      for (const resource of resources) {
        values.set(resource.name, structuredClone(applyDefaultsToSeed(seedForRuntimeState(resource, config), resource, config)));
      }
    },
    async readResource(resource, fallback) {
      return values.has(resource.name) ? structuredClone(values.get(resource.name)) : structuredClone(fallback);
    },
    async writeResource(resource) {
      throw readOnlyResourceError(resource);
    },
    async withResourceWrite(resource) {
      throw readOnlyResourceError(resource);
    },
  };
}

function readOnlyResourceError(resource) {
  return jsonDbError(
    'RUNTIME_RESOURCE_READ_ONLY',
    `Resource "${resource.name}" is configured with a read-only runtime.`,
    {
      status: 405,
      hint: 'Use a writable runtime such as "json" or remove the static runtime strategy for this resource.',
      details: {
        resource: resource.name,
        runtime: 'static',
      },
    },
  );
}
