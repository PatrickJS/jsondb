import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { openJsonFixtureDb } from '../../src/index.js';
import { makeProject, writeConfig, writeFixture } from '../helpers.js';

test('defaults apply when creating records through the package API', async () => {
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
      },
      "active": {
        "type": "boolean",
        "default": true
      }
    }
  }`);

  const db = await openJsonFixtureDb({ cwd });
  const user = await db.collection('users').create({
    id: 'u_3',
    name: 'Linus',
  });

  assert.deepEqual(user, {
    id: 'u_3',
    name: 'Linus',
    role: 'user',
    active: true,
  });
});

test('package API duplicate ids produce actionable errors', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ]));

  const db = await openJsonFixtureDb({ cwd });

  await assert.rejects(
    () => db.collection('users').create({
      id: 'u_1',
      name: 'Duplicate Ada',
    }),
    (error) => {
      assert.equal(error.code, 'DB_CREATE_DUPLICATE_ID');
      assert.match(error.message, /already exists/);
      assert.match(error.hint, /patch\/update/);
      assert.equal(error.details.resource, 'users');
      return true;
    },
  );
});

test('package create assigns a counter id when the body omits id', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true }
    },
    "seed": [
      { "id": "1", "name": "Ada Lovelace" }
    ]
  }`);

  const db = await openJsonFixtureDb({ cwd });
  const user = await db.collection('users').create({
    name: 'Grace Hopper',
  });

  assert.deepEqual(user, {
    id: '2',
    name: 'Grace Hopper',
  });
});

test('package API rejects records that do not match schema field types', async () => {
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

  await assert.rejects(
    () => db.collection('users').create({
      id: 'u_1',
      email: 42,
      role: 'owner',
    }),
    (error) => {
      assert.equal(error.code, 'DB_SCHEMA_VALIDATION_FAILED');
      assert.match(error.message, /email/);
      assert.equal(error.details.diagnostics[0].code, 'SCHEMA_FIELD_TYPE_MISMATCH');
      return true;
    },
  );
});

test('package API rejects constrained field values and unique duplicates', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "email": {
        "type": "string",
        "required": true,
        "unique": true,
        "pattern": "^[^@\\\\s]+@[^@\\\\s]+\\\\.[^@\\\\s]+$"
      },
      "age": {
        "type": "number",
        "min": 13
      }
    },
    "seed": [
      { "id": "u_1", "email": "ada@example.com", "age": 28 }
    ]
  }`);

  const db = await openJsonFixtureDb({ cwd });

  await assert.rejects(
    () => db.collection('users').create({
      id: 'u_2',
      email: 'ada@example.com',
      age: 20,
    }),
    (error) => {
      assert.equal(error.code, 'DB_SCHEMA_VALIDATION_FAILED');
      assert.equal(error.details.diagnostics[0].code, 'SCHEMA_UNIQUE_VALUE_DUPLICATE');
      assert.match(error.details.diagnostics[0].message, /email/);
      return true;
    },
  );

  await assert.rejects(
    () => db.collection('users').create({
      id: 'u_3',
      email: 'not-an-email',
      age: 12,
    }),
    (error) => {
      assert.equal(error.code, 'DB_SCHEMA_VALIDATION_FAILED');
      assert.deepEqual(
        error.details.diagnostics.map((diagnostic) => diagnostic.details.constraint),
        ['pattern', 'min'],
      );
      return true;
    },
  );
});

test('package API serializes concurrent collection writes in one process', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true }
    },
    "seed": []
  }`);

  const db = await openJsonFixtureDb({ cwd });
  await Promise.all(Array.from({ length: 12 }, (_, index) => db.collection('users').create({
    id: `u_${index}`,
    name: `User ${index}`,
  })));

  assert.equal((await db.collection('users').all()).length, 12);
});

test('package API serializes concurrent document writes in one process', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'settings.schema.jsonc', `{
    "kind": "document",
    "fields": {
      "theme": { "type": "string" },
      "locale": { "type": "string" },
      "active": { "type": "boolean" }
    },
    "seed": {
      "theme": "light"
    }
  }`);

  const db = await openJsonFixtureDb({ cwd });
  await Promise.all([
    db.document('settings').update({ locale: 'en-US' }),
    db.document('settings').update({ active: true }),
  ]);

  assert.deepEqual(await db.document('settings').all(), {
    theme: 'light',
    locale: 'en-US',
    active: true,
  });
});

test('singleton documents support JSON pointer get and set', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'settings.json', JSON.stringify({
    theme: 'light',
    features: {
      billing: false,
    },
  }));

  const db = await openJsonFixtureDb({ cwd });
  const settings = db.document('settings');

  await settings.set('/features/billing', true);

  assert.equal(await settings.get('/features/billing'), true);
  assert.equal((await settings.all()).features.billing, true);
});

test('memory runtime supports CRUD without writing JSON state files', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: 'u_1', name: 'Ada Lovelace' },
  ]));
  await writeConfig(cwd, `export default {
    runtime: {
      default: 'memory'
    }
  };`);

  const db = await openJsonFixtureDb({ cwd });
  await db.collection('users').create({ id: 'u_2', name: 'Grace Hopper' });

  assert.deepEqual(await db.collection('users').all(), [
    { id: 'u_1', name: 'Ada Lovelace' },
    { id: 'u_2', name: 'Grace Hopper' },
  ]);
  await assert.rejects(
    () => access(path.join(cwd, '.jsondb/state/users.json')),
    { code: 'ENOENT' },
  );
});

test('static runtime resources are readable and reject writes', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'settings.json', JSON.stringify({
    theme: 'light',
  }));
  await writeConfig(cwd, `export default {
    resources: {
      settings: {
        runtime: 'static'
      }
    }
  };`);

  const db = await openJsonFixtureDb({ cwd });

  assert.deepEqual(await db.document('settings').all(), { theme: 'light' });
  await assert.rejects(
    () => db.document('settings').update({ theme: 'dark' }),
    (error) => {
      assert.equal(error.code, 'RUNTIME_RESOURCE_READ_ONLY');
      assert.match(error.message, /settings/);
      return true;
    },
  );
});

test('runtime emits live events only after successful writes', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: 'u_1', name: 'Ada Lovelace' },
  ]));

  const db = await openJsonFixtureDb({ cwd });
  const events = [];
  const unsubscribe = db.events.subscribe((event) => {
    events.push(event);
  });

  await db.collection('users').create({ id: 'u_2', name: 'Grace Hopper' });
  await assert.rejects(() => db.collection('users').create({ id: 'u_2', name: 'Duplicate' }));
  unsubscribe();

  assert.equal(events.length, 1);
  assert.equal(events[0].resource, 'users');
  assert.equal(events[0].kind, 'collection');
  assert.equal(events[0].op, 'create');
  assert.equal(events[0].id, 'u_2');
  assert.equal(events[0].version, 1);
  assert.match(events[0].timestamp, /^\d{4}-\d{2}-\d{2}T/);
});
