import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { openJsonFixtureDb, syncJsonFixtureDb, loadConfig, loadProjectSchema, generateTypes } from '../src/index.js';
import { makeProject, writeConfig, writeFixture } from './helpers.js';

const execFileAsync = promisify(execFile);

test('data-first fixtures generate schema, types, and runtime state', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      role: 'admin',
    },
  ]));

  const config = await loadConfig({ cwd });
  const result = await syncJsonFixtureDb(config);

  assert.equal(result.schema.resources.users.kind, 'collection');
  assert.match(await readFile(path.join(cwd, '.jsondb/types/index.ts'), 'utf8'), /export type User =/);
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, '.jsondb/state/users.json'), 'utf8'))[0].id, 'u_1');
});

test('schema-only fixtures generate types and initialize empty state', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'auditEvents.schema.jsonc', `{
    // Audit events generated during local development.
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "type": { "type": "string", "required": true },
      "payload": { "type": "object", "default": {} }
    },
    "seed": []
  }`);

  const config = await loadConfig({ cwd });
  await syncJsonFixtureDb(config);
  const generated = await readFile(path.join(cwd, '.jsondb/types/index.ts'), 'utf8');

  assert.match(generated, /export type AuditEvent =/);
  assert.match(generated, /payload\?: Record<string, unknown>;/);
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, '.jsondb/state/auditEvents.json'), 'utf8')), []);
});

test('mixed mode treats schema as authoritative and warns for unknown data fields', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
      twitterHandle: '@ada',
    },
  ]));
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true }
    }
  }`);

  const config = await loadConfig({ cwd });
  const project = await loadProjectSchema(config);

  assert.equal(project.diagnostics.length, 1);
  assert.equal(project.diagnostics[0].severity, 'warn');
  assert.match(project.diagnostics[0].message, /twitterHandle/);
});

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

test('.schema.mjs files can use schema helpers', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.mjs', `import { collection, field } from 'json-fixture-db/schema';

export default collection({
  idField: 'id',
  fields: {
    id: field.string({ required: true, description: 'Stable user id.' }),
    role: field.enum(['admin', 'user'], { default: 'user' })
  },
  seed: [{ id: 'u_1', role: 'admin' }]
});
`);

  const config = await loadConfig({ cwd });
  const result = await generateTypes(config);

  assert.match(result.content, /\/\*\* Stable user id\. \*\//);
  assert.match(result.content, /export type UserRole = "admin" \| "user";/);
});

test('JSONC data-first fixtures can be inferred', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'settings.jsonc', `{
    // Local app settings.
    "theme": "light",
    "features": {
      "billing": false,
    },
  }`);

  const config = await loadConfig({ cwd });
  const result = await syncJsonFixtureDb(config);
  const generated = await readFile(path.join(cwd, '.jsondb/types/index.ts'), 'utf8');

  assert.equal(result.schema.resources.settings.kind, 'document');
  assert.match(generated, /export type Settings =/);
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, '.jsondb/state/settings.json'), 'utf8')), {
    theme: 'light',
    features: {
      billing: false,
    },
  });
});

test('types.commitOutFile writes a committed type copy', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    sourceDir: './db',
    stateDir: './.jsondb',
    types: {
      enabled: true,
      outFile: './.jsondb/types/index.ts',
      commitOutFile: './src/generated/jsondb.types.ts'
    }
  };`);
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));

  const config = await loadConfig({ cwd });
  await syncJsonFixtureDb(config);

  const ignoredTypes = await readFile(path.join(cwd, '.jsondb/types/index.ts'), 'utf8');
  const committedTypes = await readFile(path.join(cwd, 'src/generated/jsondb.types.ts'), 'utf8');

  assert.equal(committedTypes, ignoredTypes);
  assert.match(committedTypes, /users: User;/);
});

test('strict unknown fields fail sync in mixed mode', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    schema: {
      unknownFields: 'error'
    }
  };`);
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada', twitterHandle: '@ada' }]));
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true }
    }
  }`);

  const config = await loadConfig({ cwd });

  await assert.rejects(
    () => syncJsonFixtureDb(config),
    /twitterHandle/,
  );
});

test('schema seed records are validated without a separate data file', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "email": { "type": "string", "required": true }
    },
    "seed": [
      { "id": "u_1" }
    ]
  }`);

  const config = await loadConfig({ cwd });

  await assert.rejects(
    () => syncJsonFixtureDb(config),
    /missing required field "email"/,
  );
});

test('schema validation rejects declared field type mismatches', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "email": { "type": "string", "required": true },
      "role": { "type": "enum", "values": ["admin", "user"] },
      "profile": {
        "type": "object",
        "fields": {
          "age": { "type": "number" },
          "flags": {
            "type": "array",
            "items": { "type": "boolean" }
          }
        }
      }
    },
    "seed": [
      {
        "id": 1,
        "email": 42,
        "role": "owner",
        "profile": {
          "age": "old",
          "flags": ["yes"]
        }
      }
    ]
  }`);

  const config = await loadConfig({ cwd });
  const project = await loadProjectSchema(config);

  assert.deepEqual(
    project.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').map((diagnostic) => diagnostic.code),
    [
      'SCHEMA_FIELD_TYPE_MISMATCH',
      'SCHEMA_FIELD_TYPE_MISMATCH',
      'SCHEMA_ENUM_VALUE_INVALID',
      'SCHEMA_FIELD_TYPE_MISMATCH',
      'SCHEMA_FIELD_TYPE_MISMATCH',
    ],
  );
  assert.match(project.diagnostics.map((diagnostic) => diagnostic.message).join('\n'), /profile\.flags\[0\]/);
  await assert.rejects(() => syncJsonFixtureDb(config), /expected string/);
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

test('CLI types --out writes relative to --cwd', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));

  const { stdout } = await execFileAsync(process.execPath, [
    path.resolve('src/cli.js'),
    'types',
    '--cwd',
    cwd,
    '--out',
    './src/generated/jsondb.types.ts',
  ]);

  const generated = await readFile(path.join(cwd, 'src/generated/jsondb.types.ts'), 'utf8');

  assert.match(stdout, /Generated src\/generated\/jsondb\.types\.ts/);
  assert.match(generated, /export type User =/);
});
