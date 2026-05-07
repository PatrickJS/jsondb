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
