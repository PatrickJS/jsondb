import { openJsonFixtureDb } from './db.js';
import { serializeError } from './errors.js';
import { createJsonDbRequestHandler, createViewerEventHub, watchSourceDir } from './server.js';
import { sendJson } from './rest/handler.js';

const DEFAULT_VIRTUAL_CLIENT_MODULE = 'virtual:jsondb/client';

export function jsondbPlugin(options = {}) {
  const routes = resolveViteRoutes(options);
  const virtualModuleId = options.clientVirtualModule === false
    ? null
    : options.clientVirtualModule ?? DEFAULT_VIRTUAL_CLIENT_MODULE;
  const resolvedVirtualModuleId = virtualModuleId ? `\0${virtualModuleId}` : null;

  return {
    name: 'json-fixture-db:vite',
    apply: 'serve',

    async configureServer(server) {
      const db = await openJsonFixtureDb({
        ...jsondbOptions(options),
        allowSourceErrors: true,
      });
      const events = createViewerEventHub();
      const watcher = await watchSourceDir(db, events, {
        warn(message) {
          server.config?.logger?.warn?.(message);
        },
      });
      const handler = createJsonDbRequestHandler(db, {
        ...routes,
        events,
      });

      server.middlewares.use((request, response, next) => {
        handler(request, response, next).catch((error) => {
          sendJson(response, error.status ?? 500, serializeError(error, 'SERVER_ERROR'));
        });
      });

      server.httpServer?.once?.('close', () => {
        watcher.close();
        events.close();
      });
    },

    resolveId(id) {
      return id === virtualModuleId ? resolvedVirtualModuleId : null;
    },

    load(id) {
      if (id !== resolvedVirtualModuleId) {
        return null;
      }

      return renderVirtualClient(routes);
    },
  };
}

function resolveViteRoutes(options) {
  const apiBase = normalizeBasePath(options.apiBase ?? '/__jsondb');
  return {
    apiBase,
    rootRoutes: options.rootRoutes === true,
    restBasePath: normalizeBasePath(options.restBasePath ?? `${apiBase}/rest`),
    graphqlPath: normalizeBasePath(options.graphqlPath ?? `${apiBase}/graphql`),
  };
}

function renderVirtualClient(routes) {
  return `import { createJsonDbClient } from 'json-fixture-db/client';

export const client = createJsonDbClient({
  restBasePath: ${JSON.stringify(routes.restBasePath)},
  restBatchPath: ${JSON.stringify(`${routes.apiBase}/batch`)},
  graphqlPath: ${JSON.stringify(routes.graphqlPath)},
});

export default client;
`;
}

function jsondbOptions(options) {
  const {
    apiBase,
    rootRoutes,
    restBasePath,
    graphqlPath,
    clientVirtualModule,
    ...jsondb
  } = options;
  return jsondb;
}

function normalizeBasePath(value) {
  const path = `/${String(value ?? '').replace(/^\/+/, '').replace(/\/+$/, '')}`;
  return path === '/' ? '' : path;
}
