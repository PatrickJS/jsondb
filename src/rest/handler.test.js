import assert from 'node:assert/strict';
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

function makeRequest(method, body) {
  return {
    method,
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) {
        yield Buffer.from(JSON.stringify(body));
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
