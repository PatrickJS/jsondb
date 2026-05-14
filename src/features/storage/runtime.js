import { jsonDbError, listChoices } from '../../errors.js';
import { resourceConfigValue } from '../../names.js';
import { createJsonRuntimeAdapter } from './json.js';
import { createMemoryRuntimeAdapter } from './memory.js';
import { createSourceRuntimeAdapter } from './source.js';
import { createStaticRuntimeAdapter } from './static.js';
import { createRuntimeEventHub } from './events.js';

export function createRuntime(config, resources) {
  const events = createRuntimeEventHub();
  const adapters = new Map();

  for (const adapter of builtinAdapters(config)) {
    adapters.set(adapter.name, adapter);
  }

  for (const adapterFactory of config.runtime?.adapters ?? []) {
    const adapter = typeof adapterFactory === 'function'
      ? adapterFactory({ config, resources })
      : adapterFactory;
    if (adapter?.name) {
      adapters.set(adapter.name, adapter);
    }
  }

  return {
    events,
    adapterNames() {
      return [...adapters.keys()];
    },
    strategyFor(resource) {
      const resourceConfig = resourceConfigValue(config.resources, resource.name);
      const configured = resourceConfig?.runtime ?? config.runtime?.default ?? 'json';
      return typeof configured === 'string' ? configured : configured?.adapter ?? configured?.name ?? 'json';
    },
    adapterFor(resource) {
      const strategy = this.strategyFor(resource);
      const adapter = adapters.get(strategy);
      if (!adapter) {
        throw jsonDbError(
          'RUNTIME_ADAPTER_NOT_FOUND',
          `Runtime adapter "${strategy}" is not registered for resource "${resource.name}".`,
          {
            status: 500,
            hint: `Register one of: ${listChoices([...adapters.keys()])}.`,
            details: {
              resource: resource.name,
              runtime: strategy,
              availableRuntimes: [...adapters.keys()],
            },
          },
        );
      }
      return adapter;
    },
    async hydrate() {
      const byAdapter = new Map();
      for (const resource of resources) {
        const adapter = this.adapterFor(resource);
        const group = byAdapter.get(adapter) ?? [];
        group.push(resource);
        byAdapter.set(adapter, group);
      }

      for (const [adapter, adapterResources] of byAdapter) {
        await adapter.hydrate?.(adapterResources);
      }
    },
    emit(change) {
      return events.emit(change);
    },
  };
}

function builtinAdapters(config) {
  return [
    createJsonRuntimeAdapter(config),
    createMemoryRuntimeAdapter(config),
    createSourceRuntimeAdapter(config),
    createStaticRuntimeAdapter(config),
  ];
}
