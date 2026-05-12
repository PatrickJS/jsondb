import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { openJsonFixtureDb } from './db.js';
import { makeProject, writeFixture } from '../test/helpers.js';
import { createJsonDbRequestHandler, reloadJsonFixtureDb, watchSourceDir } from './server.js';

test('server reload path keeps valid resources when another source file fails', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));

  const db = await openJsonFixtureDb({ cwd, allowSourceErrors: true });
  await writeFixture(cwd, 'posts.json', JSON.stringify([{ id: 'p_1', title: 'Hello' }]));

  const withPosts = await reloadJsonFixtureDb(db);
  assert.equal(withPosts.schema.resources.posts.routePath, '/posts');
  assert.equal(Boolean(db.resources.get('posts')), true);

  await writeFixture(cwd, 'broken.json', '{"id": ');

  const withError = await reloadJsonFixtureDb(db);
  assert.equal(Boolean(withError.schema.resources.users), true);
  assert.equal(Boolean(withError.schema.resources.posts), true);
  assert.equal(withError.diagnostics[0].code, 'SOURCE_LOAD_FAILED');
  assert.equal(withError.diagnostics[0].file, 'db/broken.json');
  assert.equal(Boolean(db.resources.get('users')), true);
  assert.equal(Boolean(db.resources.get('posts')), true);
});

test('server source watch falls back without crashing when file watchers are unavailable', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));

  const db = await openJsonFixtureDb({ cwd, allowSourceErrors: true });
  const published = [];
  const warnings = [];
  const error = new Error('too many open files, watch');
  error.code = 'EMFILE';

  const watcher = await watchSourceDir(db, {
    publish(payload) {
      published.push(payload);
    },
  }, {
    watch() {
      throw error;
    },
    warn(message) {
      warnings.push(message);
    },
  });

  assert.equal(watcher.enabled, false);
  assert.equal(db.diagnostics.at(-1).code, 'SERVER_WATCH_UNAVAILABLE');
  assert.equal(published[0].type, 'watch-disabled');
  assert.match(warnings[0], /disabled.*too many open files/i);
  watcher.close();
});

test('server source watch handles watcher error events without crashing', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));

  const db = await openJsonFixtureDb({ cwd, allowSourceErrors: true });
  const published = [];
  const warnings = [];
  const fsWatcher = new EventEmitter();
  fsWatcher.close = () => {};

  const watcher = await watchSourceDir(db, {
    publish(payload) {
      published.push(payload);
    },
  }, {
    watch() {
      return fsWatcher;
    },
    warn(message) {
      warnings.push(message);
    },
  });

  const error = new Error('system limit for number of file watchers reached');
  error.code = 'ENOSPC';
  fsWatcher.emit('error', error);

  assert.equal(watcher.enabled, false);
  assert.equal(db.diagnostics.at(-1).code, 'SERVER_WATCH_UNAVAILABLE');
  assert.equal(published[0].type, 'watch-disabled');
  assert.match(warnings[0], /disabled.*file watchers/i);
  watcher.close();
});

test('request handler supports scoped Vite routes without root REST routes', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada',
    },
  ]));

  const db = await openJsonFixtureDb({ cwd, allowSourceErrors: true });
  const handler = createJsonDbRequestHandler(db, {
    apiBase: '/__jsondb',
    rootRoutes: false,
    graphqlPath: '/__jsondb/graphql',
    restBasePath: '/__jsondb/rest',
  });

  const users = makeResponse();
  const schema = makeResponse();
  const batch = makeResponse();
  const graphql = makeResponse();
  const rootUsers = makeResponse();
  let passedThrough = false;

  assert.equal(await handler(makeRequest('GET', '/__jsondb/rest/users'), users), true);
  assert.equal(await handler(makeRequest('GET', '/__jsondb/schema'), schema), true);
  assert.equal(await handler(makeRequest('POST', '/__jsondb/batch', [
    { method: 'GET', path: '/users' },
  ]), batch), true);
  assert.equal(await handler(makeRequest('POST', '/__jsondb/graphql', {
    query: '{ users { id } }',
  }), graphql), true);
  assert.equal(await handler(makeRequest('GET', '/users'), rootUsers, () => {
    passedThrough = true;
  }), false);

  assert.equal(users.status, 200);
  assert.deepEqual(users.json(), [{ id: 'u_1', name: 'Ada' }]);
  assert.equal(schema.status, 200);
  assert.equal(schema.json().resources.users.routePath, '/users');
  assert.equal(batch.status, 200);
  assert.equal(batch.json()[0].body[0].id, 'u_1');
  assert.equal(graphql.status, 200);
  assert.deepEqual(graphql.json().data.users, [{ id: 'u_1' }]);
  assert.equal(rootUsers.status, null);
  assert.equal(passedThrough, true);
});

test('request handler preserves standalone root REST and GraphQL routes', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada',
    },
  ]));

  const db = await openJsonFixtureDb({ cwd, allowSourceErrors: true });
  const handler = createJsonDbRequestHandler(db);
  const users = makeResponse();
  const graphql = makeResponse();

  assert.equal(await handler(makeRequest('GET', '/users'), users), true);
  assert.equal(await handler(makeRequest('POST', '/graphql', {
    query: '{ users { id } }',
  }), graphql), true);

  assert.equal(users.status, 200);
  assert.deepEqual(users.json(), [{ id: 'u_1', name: 'Ada' }]);
  assert.equal(graphql.status, 200);
  assert.deepEqual(graphql.json().data.users, [{ id: 'u_1' }]);
});

function makeRequest(method, path, body) {
  return {
    method,
    url: path,
    headers: {},
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) {
        yield Buffer.from(JSON.stringify(body));
      }
    },
    on() {},
  };
}

function makeResponse() {
  return {
    status: null,
    headers: {},
    body: '',
    writeHead(status, headers = {}) {
      this.status = status;
      this.headers = headers;
    },
    write(chunk = '') {
      this.body += chunk;
    },
    end(chunk = '') {
      this.body += chunk;
    },
    json() {
      return this.body ? JSON.parse(this.body) : null;
    },
  };
}
