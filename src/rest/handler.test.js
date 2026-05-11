import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { openJsonFixtureDb } from '../index.js';
import { makeProject, writeFixture } from '../../test/helpers.js';
import { handleRestRequest } from './handler.js';

test('REST handler resolves generated kebab-case collection routes', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'auditEvents.json', JSON.stringify([
    {
      id: 'evt_1',
      type: 'created',
    },
  ]));

  const db = await openJsonFixtureDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('GET'),
    response,
    new URL('http://jsondb.local/audit-events'),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.json(), [
    {
      id: 'evt_1',
      type: 'created',
    },
  ]);
});

test('REST handler serves the built-in jsondb viewer', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ]));

  const db = await openJsonFixtureDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('GET'),
    response,
    new URL('http://jsondb.local/__jsondb'),
  );

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /text\/html/);
  assert.match(response.body, /jsondb viewer/);
  assert.match(response.body, /REST Specs/);
  assert.match(response.body, /GraphQL Examples/);
});

test('REST root returns JSON discovery links by default', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ]));

  const db = await openJsonFixtureDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('GET'),
    response,
    new URL('http://jsondb.local/'),
  );

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /application\/json/);
  assert.deepEqual(response.json(), {
    resources: ['users'],
    viewer: '/__jsondb',
    schema: '/__jsondb/schema',
    graphql: '/graphql',
    links: {
      viewer: '/__jsondb',
      schema: '/__jsondb/schema',
      graphql: '/graphql',
      resources: {
        users: '/users',
      },
    },
  });
});

test('REST root returns HTML discovery links for browser requests', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'chartMappings.json', JSON.stringify([
    {
      id: 'mapping_1',
      chartId: 'chart_1',
    },
  ]));

  const db = await openJsonFixtureDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('GET', undefined, {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    }),
    response,
    new URL('http://jsondb.local/'),
  );

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /text\/html/);
  assert.match(response.body, /jsondb/);
  assert.match(response.body, /Data Viewer/);
  assert.match(response.body, /href="\/__jsondb"/);
  assert.match(response.body, /Schema/);
  assert.match(response.body, /href="\/__jsondb\/schema"/);
  assert.match(response.body, /GraphQL/);
  assert.match(response.body, /href="\/graphql"/);
  assert.match(response.body, /chartMappings/);
  assert.match(response.body, /href="\/chart-mappings"/);
});

test('REST schema endpoint exposes route paths for the viewer', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'auditEvents.json', JSON.stringify([
    {
      id: 'evt_1',
      type: 'created',
    },
  ]));

  const db = await openJsonFixtureDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('GET'),
    response,
    new URL('http://jsondb.local/__jsondb/schema'),
  );

  assert.equal(response.status, 200);
  assert.equal(response.json().resources.auditEvents.routePath, '/audit-events');
});

test('REST viewer import endpoint saves CSV fixtures and reloads resources', async () => {
  const cwd = await makeProject();
  const db = await openJsonFixtureDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRawRequest('POST', 'User ID,Email,Active\nu_1,ada@example.com,true\n', {
      'x-jsondb-file-name': 'Uploaded Users.csv',
    }),
    response,
    new URL('http://jsondb.local/__jsondb/import'),
  );

  assert.equal(response.status, 201);
  assert.equal(response.json().resource, 'uploadedUsers');
  assert.equal(response.json().dataPath, 'db/uploadedUsers.csv');
  assert.equal(db.resourceNames().includes('uploadedUsers'), true);
  assert.deepEqual(await db.collection('uploadedUsers').all(), [
    {
      userId: 'u_1',
      email: 'ada@example.com',
      active: true,
    },
  ]);
});

test('REST viewer import endpoint saves CSV fixtures to configured dbDir', async () => {
  const cwd = await makeProject();
  const db = await openJsonFixtureDb({ cwd, dbDir: './jsondb' });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRawRequest('POST', 'id,name\nu_1,Ada\n', {
      'x-jsondb-file-name': 'Uploaded Users.csv',
    }),
    response,
    new URL('http://jsondb.local/__jsondb/import'),
  );

  assert.equal(response.status, 201);
  assert.equal(response.json().dataPath, 'jsondb/uploadedUsers.csv');
  await access(path.join(cwd, 'jsondb/uploadedUsers.csv'));
});

test('REST viewer import endpoint rejects invalid CSV without writing a fixture', async () => {
  const cwd = await makeProject();
  const db = await openJsonFixtureDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRawRequest('POST', 'id,name\n"u_1,Ada\n', {
      'x-jsondb-file-name': 'Bad Upload.csv',
    }),
    response,
    new URL('http://jsondb.local/__jsondb/import'),
  );

  assert.equal(response.status, 400);
  assert.equal(response.json().error.code, 'CSV_UNTERMINATED_QUOTE');
  await assert.rejects(access(path.join(cwd, 'db', 'badUpload.csv')), {
    code: 'ENOENT',
  });
});

test('REST handler creates collection records and applies defaults', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true },
      "role": {
        "type": "enum",
        "values": ["admin", "user"],
        "default": "user"
      }
    },
    "seed": []
  }`);

  const db = await openJsonFixtureDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('POST', {
      id: 'u_1',
      name: 'Ada Lovelace',
    }),
    response,
    new URL('http://jsondb.local/users'),
  );

  assert.equal(response.status, 201);
  assert.deepEqual(response.json(), {
    id: 'u_1',
    name: 'Ada Lovelace',
    role: 'user',
  });
});

test('REST handler rejects writes that do not match schema field types', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "email": { "type": "string", "required": true },
      "role": { "type": "enum", "values": ["admin", "user"] }
    },
    "seed": []
  }`);

  const db = await openJsonFixtureDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('POST', {
      id: 'u_1',
      email: 42,
      role: 'owner',
    }),
    response,
    new URL('http://jsondb.local/users'),
  );

  assert.equal(response.status, 400);
  assert.equal(response.json().error.code, 'DB_SCHEMA_VALIDATION_FAILED');
  assert.match(response.json().error.details.diagnostics[0].message, /email/);
});

test('REST handler updates singleton documents', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'settings.json', JSON.stringify({
    theme: 'light',
    locale: 'en-US',
  }));

  const db = await openJsonFixtureDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('PATCH', {
      theme: 'dark',
    }),
    response,
    new URL('http://jsondb.local/settings'),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.json(), {
    theme: 'dark',
    locale: 'en-US',
  });
});

test('REST batch is sequential and keeps earlier successful writes when a later item fails', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "email": { "type": "string", "required": true },
      "role": { "type": "enum", "values": ["admin", "user"] }
    },
    "seed": []
  }`);

  const db = await openJsonFixtureDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('POST', [
      {
        method: 'POST',
        path: '/users',
        body: {
          id: 'u_1',
          email: 'ada@example.com',
          role: 'admin',
        },
      },
      {
        method: 'POST',
        path: '/users',
        body: {
          id: 'u_2',
          email: 'grace@example.com',
          role: 'owner',
        },
      },
    ]),
    response,
    new URL('http://jsondb.local/__jsondb/batch'),
  );

  assert.equal(response.status, 200);
  assert.equal(response.json()[0].status, 201);
  assert.equal(response.json()[1].status, 400);
  assert.equal(response.json()[1].body.error.code, 'DB_SCHEMA_VALIDATION_FAILED');
  assert.deepEqual(await db.collection('users').all(), [
    {
      id: 'u_1',
      email: 'ada@example.com',
      role: 'admin',
    },
  ]);
});

test('REST handler supports batched requests', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true },
      "role": {
        "type": "enum",
        "values": ["admin", "user"],
        "default": "user"
      }
    },
    "seed": []
  }`);

  const db = await openJsonFixtureDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('POST', [
      {
        method: 'POST',
        path: '/users',
        body: {
          id: 'u_1',
          name: 'Ada Lovelace',
        },
      },
      {
        method: 'GET',
        path: '/users/u_1',
      },
    ]),
    response,
    new URL('http://jsondb.local/__jsondb/batch'),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.json(), [
    {
      index: 0,
      status: 201,
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body: {
        id: 'u_1',
        name: 'Ada Lovelace',
        role: 'user',
      },
    },
    {
      index: 1,
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body: {
        id: 'u_1',
        name: 'Ada Lovelace',
        role: 'user',
      },
    },
  ]);
});

test('REST batch errors include code hint and item index', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([]));

  const db = await openJsonFixtureDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('POST', [
      {
        method: 'GET',
        path: 'users',
      },
    ]),
    response,
    new URL('http://jsondb.local/__jsondb/batch'),
  );

  assert.equal(response.status, 200);
  assert.equal(response.json()[0].index, 0);
  assert.equal(response.json()[0].status, 400);
  assert.equal(response.json()[0].body.error.code, 'REST_BATCH_INVALID_PATH');
  assert.match(response.json()[0].body.error.hint, /absolute local paths/);
});

test('REST handler returns 413 for oversized JSON bodies', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([]));

  const db = await openJsonFixtureDb({
    cwd,
    server: {
      maxBodyBytes: 12,
    },
  });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('POST', {
      id: 'u_1',
      name: 'payload is too large',
    }),
    response,
    new URL('http://jsondb.local/users'),
  );

  assert.equal(response.status, 413);
  assert.equal(response.json().error.code, 'JSON_BODY_TOO_LARGE');
  assert.match(response.json().error.hint, /server\.maxBodyBytes/);
});

function makeRequest(method, body, headers = {}) {
  return {
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) {
        yield Buffer.from(JSON.stringify(body));
      }
    },
  };
}

function makeRawRequest(method, body, headers = {}) {
  return {
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) {
        yield Buffer.from(body);
      }
    },
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
    end(chunk = '') {
      this.body += chunk;
    },
    json() {
      return this.body ? JSON.parse(this.body) : null;
    },
  };
}
