import assert from 'node:assert/strict';
import test from 'node:test';
import { jsondbPlugin } from './vite.js';
import { makeProject, writeFixture } from '../test/helpers.js';

test('jsondb Vite plugin is serve-only and exposes a virtual client module', async () => {
  const plugin = jsondbPlugin({
    apiBase: '/__jsondb',
  });

  assert.equal(plugin.name, 'jsondb:vite');
  assert.equal(plugin.apply, 'serve');
  assert.equal(await plugin.resolveId('virtual:jsondb/client'), '\0virtual:jsondb/client');

  const loaded = await plugin.load('\0virtual:jsondb/client');
  assert.match(loaded, /jsondb\/client/);
  assert.match(loaded, /restBasePath: "\/__jsondb\/rest"/);
  assert.match(loaded, /graphqlPath: "\/__jsondb\/graphql"/);
  assert.match(loaded, /restBatchPath: "\/__jsondb\/batch"/);
  assert.match(loaded, /export function fork/);
  assert.match(loaded, /client\.fork = fork/);
});

test('jsondb Vite virtual client creates fork clients under the configured apiBase', async () => {
  const plugin = jsondbPlugin({
    apiBase: '/local-data',
  });

  const loaded = await plugin.load('\0virtual:jsondb/client');

  assert.match(loaded, /const forkBase = `\/local-data\/forks\/\$\{encodeURIComponent\(forkName\)\}`;/);
  assert.match(loaded, /restBasePath: `\$\{forkBase\}\/rest`/);
  assert.match(loaded, /restBatchPath: `\$\{forkBase\}\/batch`/);
  assert.match(loaded, /graphqlPath: `\$\{forkBase\}\/graphql`/);
});

test('jsondb Vite plugin can render a custom client import for the virtual module', async () => {
  const plugin = jsondbPlugin({
    clientImport: '@local/jsondb/client',
  });

  const loaded = await plugin.load('\0virtual:jsondb/client');
  assert.match(loaded, /@local\/jsondb\/client/);
});

test('jsondb Vite plugin registers middleware with Vite dev server', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));

  const plugin = jsondbPlugin({ cwd });
  const middlewares = [];
  let closeServer;
  const server = {
    middlewares: {
      use(middleware) {
        middlewares.push(middleware);
      },
    },
    httpServer: {
      once(event, callback) {
        if (event === 'close') {
          closeServer = callback;
        }
      },
    },
    config: {
      logger: {
        warn() {},
      },
    },
  };

  await plugin.configureServer(server);

  assert.equal(middlewares.length, 1);
  assert.equal(typeof middlewares[0], 'function');
  closeServer?.();
});

test('jsondb Vite plugin can disable the virtual client module', async () => {
  const plugin = jsondbPlugin({
    clientVirtualModule: false,
  });

  assert.equal(await plugin.resolveId('virtual:jsondb/client'), null);
});
