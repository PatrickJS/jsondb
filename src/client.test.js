import assert from 'node:assert/strict';
import test from 'node:test';
import { createJsonDbClient } from './client.js';

test('client can batch explicit GraphQL requests', async () => {
  const calls = withMockFetch([
    [
      { data: { users: [] } },
      { data: { settings: { theme: 'light' } } },
    ],
  ]);

  const client = createJsonDbClient({ baseUrl: 'http://jsondb.local' });
  const result = await client.graphql.batch([
    { query: '{ users { id } }' },
    { query: '{ settings { theme } }' },
  ]);

  assert.deepEqual(result, [
    { data: { users: [] } },
    { data: { settings: { theme: 'light' } } },
  ]);
  assert.equal(calls[0].url, 'http://jsondb.local/graphql');
  assert.deepEqual(JSON.parse(calls[0].init.body), [
    { query: '{ users { id } }' },
    { query: '{ settings { theme } }' },
  ]);
});

test('client can automatically batch GraphQL requests', async () => {
  const calls = withMockFetch([
    [
      { data: { first: true } },
      { data: { second: true } },
    ],
  ]);

  const client = createJsonDbClient({
    baseUrl: 'http://jsondb.local',
    batching: true,
  });

  const [first, second] = await Promise.all([
    client.graphql('{ first }'),
    client.graphql('{ second }'),
  ]);

  assert.deepEqual(first, { data: { first: true } });
  assert.deepEqual(second, { data: { second: true } });
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].init.body), [
    { query: '{ first }' },
    { query: '{ second }' },
  ]);
});

test('client automatic batching uses a 10ms default window', async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const delays = [];
  globalThis.setTimeout = (callback, delay, ...args) => {
    delays.push(delay);
    return originalSetTimeout(callback, 0, ...args);
  };

  withMockFetch([
    [
      { data: { users: [] } },
    ],
  ]);

  const client = createJsonDbClient({
    baseUrl: 'http://jsondb.local',
    batching: true,
  });

  try {
    await client.graphql('{ users { id } }');
    assert.equal(delays[0], 10);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test('client automatic batching dedupes identical GraphQL requests', async () => {
  const calls = withMockFetch([
    [
      { data: { users: [{ id: 'u_1' }] } },
    ],
  ]);

  const client = createJsonDbClient({
    baseUrl: 'http://jsondb.local',
    batching: true,
  });

  const query = '{ users { id } }';
  const [first, second] = await Promise.all([
    client.graphql(query),
    client.graphql(query),
  ]);

  assert.deepEqual(first, { data: { users: [{ id: 'u_1' }] } });
  assert.deepEqual(second, { data: { users: [{ id: 'u_1' }] } });
  assert.deepEqual(JSON.parse(calls[0].init.body), [
    { query },
  ]);
});

test('client automatic batching does not dedupe GraphQL mutations by default', async () => {
  const calls = withMockFetch([
    [
      { data: { createUser: { id: 'u_1' } } },
      { data: { createUser: { id: 'u_1' } } },
    ],
  ]);

  const client = createJsonDbClient({
    baseUrl: 'http://jsondb.local',
    batching: true,
  });

  const mutation = 'mutation { createUser(input: { id: "u_1" }) { id } }';
  const [first, second] = await Promise.all([
    client.graphql(mutation),
    client.graphql(mutation),
  ]);

  assert.deepEqual(first, { data: { createUser: { id: 'u_1' } } });
  assert.deepEqual(second, { data: { createUser: { id: 'u_1' } } });
  assert.deepEqual(JSON.parse(calls[0].init.body), [
    { query: mutation },
    { query: mutation },
  ]);
});

test('client automatic batching can explicitly dedupe all GraphQL requests', async () => {
  const calls = withMockFetch([
    [
      { data: { createUser: { id: 'u_1' } } },
    ],
  ]);

  const client = createJsonDbClient({
    baseUrl: 'http://jsondb.local',
    batching: {
      enabled: true,
      dedupe: 'all',
    },
  });

  const mutation = 'mutation { createUser(input: { id: "u_1" }) { id } }';
  const [first, second] = await Promise.all([
    client.graphql(mutation),
    client.graphql(mutation),
  ]);

  assert.deepEqual(first, { data: { createUser: { id: 'u_1' } } });
  assert.deepEqual(second, { data: { createUser: { id: 'u_1' } } });
  assert.deepEqual(JSON.parse(calls[0].init.body), [
    { query: mutation },
  ]);
});

test('client can batch REST requests', async () => {
  const calls = withMockFetch([
    [
      {
        status: 200,
        headers: {},
        body: [{ id: 'u_1' }],
      },
      {
        status: 200,
        headers: {},
        body: { theme: 'light' },
      },
    ],
  ]);

  const client = createJsonDbClient({ baseUrl: 'http://jsondb.local' });
  const result = await client.rest.batch([
    { method: 'GET', path: '/users' },
    { method: 'GET', path: '/settings' },
  ]);

  assert.deepEqual(result, [
    {
      status: 200,
      headers: {},
      body: [{ id: 'u_1' }],
    },
    {
      status: 200,
      headers: {},
      body: { theme: 'light' },
    },
  ]);
  assert.equal(calls[0].url, 'http://jsondb.local/__jsondb/batch');
});

test('client automatic batching dedupes REST GET requests but not writes by default', async () => {
  const calls = withMockFetch([
    [
      {
        status: 200,
        headers: {},
        body: [{ id: 'u_1' }],
      },
      {
        status: 201,
        headers: {},
        body: { id: 'u_2' },
      },
      {
        status: 201,
        headers: {},
        body: { id: 'u_2' },
      },
    ],
  ]);

  const client = createJsonDbClient({
    baseUrl: 'http://jsondb.local',
    batching: true,
  });

  const [firstRead, secondRead, firstWrite, secondWrite] = await Promise.all([
    client.rest.get('/users'),
    client.rest.get('/users'),
    client.rest.post('/users', { id: 'u_2' }),
    client.rest.post('/users', { id: 'u_2' }),
  ]);

  assert.deepEqual(firstRead.body, [{ id: 'u_1' }]);
  assert.deepEqual(secondRead.body, [{ id: 'u_1' }]);
  assert.equal(firstWrite.status, 201);
  assert.equal(secondWrite.status, 201);
  assert.deepEqual(JSON.parse(calls[0].init.body), [
    { method: 'GET', path: '/users' },
    { method: 'POST', path: '/users', body: { id: 'u_2' } },
    { method: 'POST', path: '/users', body: { id: 'u_2' } },
  ]);
});

test('client HTTP errors explain the failing URL and response body', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: false,
      status: 503,
      headers: new Headers(),
      async text() {
        return JSON.stringify({
          error: {
            code: 'SERVER_DOWN',
            message: 'Server unavailable',
          },
        });
      },
    };
  };

  test.after(() => {
    globalThis.fetch = originalFetch;
  });

  const client = createJsonDbClient({ baseUrl: 'http://jsondb.local' });

  await assert.rejects(
    () => client.graphql('{ users { id } }'),
    (error) => {
      assert.equal(error.code, 'CLIENT_HTTP_ERROR');
      assert.match(error.message, /http:\/\/jsondb\.local\/graphql/);
      assert.equal(error.details.responseBody.error.code, 'SERVER_DOWN');
      return true;
    },
  );
});

function withMockFetch(responses) {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const body = responses.shift();
    return {
      status: 200,
      headers: new Headers(),
      async text() {
        return JSON.stringify(body);
      },
    };
  };

  test.after(() => {
    globalThis.fetch = originalFetch;
  });

  return calls;
}
