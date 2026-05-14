import { applyDefaultsToSeed } from '../sync/defaults.js';
import { seedForRuntimeState } from '../sync/synthetic-seed.js';

export const memoryRuntimeCapabilities = {
  writable: true,
  persistence: 'memory',
  atomicity: 'process',
  liveEvents: true,
  staticExport: false,
  production: false,
};

export function createMemoryRuntimeAdapter(config) {
  const values = new Map();
  const queues = new Map();

  return {
    name: 'memory',
    capabilities: memoryRuntimeCapabilities,
    async hydrate(resources) {
      for (const resource of resources) {
        values.set(resource.name, clone(applyDefaultsToSeed(seedForRuntimeState(resource, config), resource, config)));
      }
    },
    async readResource(resource, fallback) {
      return values.has(resource.name) ? clone(values.get(resource.name)) : clone(fallback);
    },
    async writeResource(resource, value) {
      values.set(resource.name, clone(value));
    },
    withResourceWrite(resource, operation) {
      const previous = queues.get(resource.name) ?? Promise.resolve();
      const current = previous.then(operation, operation);
      const stored = current.catch(() => {});
      queues.set(resource.name, stored);
      stored.finally(() => {
        if (queues.get(resource.name) === stored) {
          queues.delete(resource.name);
        }
      });
      return current;
    },
  };
}

function clone(value) {
  return value === undefined ? value : structuredClone(value);
}
