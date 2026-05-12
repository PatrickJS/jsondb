import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { openJsonFixtureDb, syncJsonFixtureDb, loadConfig, loadProjectSchema, generateTypes, runJsonDbDoctor } from '../src/index.js';
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

test('default config adds a small local mock delay range', async () => {
  const cwd = await makeProject();
  const config = await loadConfig({ cwd });

  assert.deepEqual(config.mock.delay, [30, 100]);
});

test('dbDir config changes the fixture source folder', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    dbDir: './jsondb',
  };`);
  await mkdir(path.join(cwd, 'jsondb'), { recursive: true });
  await writeFile(path.join(cwd, 'jsondb/users.json'), `${JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ])}\n`, 'utf8');

  const config = await loadConfig({ cwd });
  const result = await syncJsonFixtureDb(config);
  const metadata = JSON.parse(await readFile(path.join(cwd, '.jsondb/state/.sources.json'), 'utf8'));

  assert.equal(config.dbDir, path.join(cwd, 'jsondb'));
  assert.equal(config.sourceDir, path.join(cwd, 'jsondb'));
  assert.equal(result.schema.resources.users.kind, 'collection');
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, '.jsondb/state/users.json'), 'utf8')), [
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ]);
  assert.equal(metadata.resources.users.path, 'jsondb/users.json');
});

test('config files can use the typed defineConfig helper', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `import { defineConfig } from 'jsondb/config';

export default defineConfig({
  mode: 'mirror',
  mock: {
    delay: [75, 250],
  },
});
`);

  const config = await loadConfig({ cwd });

  assert.equal(config.mode, 'mirror');
  assert.deepEqual(config.mock.delay, [75, 250]);
});

test('consumer projects can import package APIs through the jsondb alias', async () => {
  const cwd = await makeProject();
  await writeFile(path.join(cwd, 'check-alias.mjs'), `import { createJsonDbRequestHandler, openJsonFixtureDb } from 'jsondb';
import { createJsonDbClient } from 'jsondb/client';
import { defineConfig } from 'jsondb/config';

if (typeof openJsonFixtureDb !== 'function') throw new Error('missing package API');
if (typeof createJsonDbRequestHandler !== 'function') throw new Error('missing request handler API');
if (typeof createJsonDbClient !== 'function') throw new Error('missing client API');
if (typeof defineConfig !== 'function') throw new Error('missing config API');
`);

  await execFileAsync(process.execPath, ['check-alias.mjs'], { cwd });
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

test('schema fields support nullable datetime arrays and flexible object shapes', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'charts.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "ownerPersonId": { "type": "string", "nullable": true },
      "lastViewedAt": { "type": "datetime" },
      "tags": {
        "type": "array",
        "items": { "type": "string" }
      },
      "schemaSnapshot": {
        "type": "object",
        "additionalProperties": true,
        "fields": {
          "version": { "type": "number" }
        }
      }
    },
    "seed": [
      {
        "id": "chart_1",
        "ownerPersonId": null,
        "lastViewedAt": "2026-05-11T12:00:00.000Z",
        "tags": ["renewal", "priority"],
        "schemaSnapshot": {
          "version": 1,
          "displayOverrides": { "color": "green" }
        }
      }
    ]
  }`);

  const config = await loadConfig({ cwd });
  const result = await syncJsonFixtureDb(config);
  const generated = await readFile(path.join(cwd, '.jsondb/types/index.ts'), 'utf8');
  const state = JSON.parse(await readFile(path.join(cwd, '.jsondb/state/charts.json'), 'utf8'));

  assert.deepEqual(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'), []);
  assert.match(generated, /ownerPersonId\?: string \| null;/);
  assert.match(generated, /lastViewedAt\?: string;/);
  assert.match(generated, /tags\?: Array<string>;/);
  assert.match(generated, /schemaSnapshot\?: \{/);
  assert.match(generated, /version\?: number;/);
  assert.match(generated, /\[key: string\]: unknown;/);
  assert.deepEqual(state[0].tags, ['renewal', 'priority']);
});

test('schema fields can declare to-one relation metadata', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'authors.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true }
    },
    "seed": [
      { "id": "a_1", "name": "Ada Lovelace" }
    ]
  }`);
  await writeFixture(cwd, 'posts.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "title": { "type": "string", "required": true },
      "authorId": {
        "type": "string",
        "required": true,
        "relation": {
          "name": "author",
          "to": "authors",
          "toField": "id",
          "cardinality": "one"
        }
      }
    },
    "seed": [
      { "id": "p_1", "title": "Intro", "authorId": "a_1" }
    ]
  }`);

  const config = await loadConfig({ cwd });
  const result = await syncJsonFixtureDb(config);

  assert.deepEqual(result.schema.resources.posts.relations, [
    {
      name: 'author',
      sourceResource: 'posts',
      sourceField: 'authorId',
      targetResource: 'authors',
      targetField: 'id',
      cardinality: 'one',
    },
  ]);
  assert.deepEqual(result.schema.relations, result.schema.resources.posts.relations);
  assert.deepEqual(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'), []);
});

test('schema validation reports missing required relation targets', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'authors.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true }
    },
    "seed": []
  }`);
  await writeFixture(cwd, 'posts.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "authorId": {
        "type": "string",
        "required": true,
        "relation": {
          "name": "author",
          "to": "authors",
          "toField": "id",
          "cardinality": "one"
        }
      }
    },
    "seed": [
      { "id": "p_1", "authorId": "missing_author" }
    ]
  }`);

  const config = await loadConfig({ cwd });
  const project = await loadProjectSchema(config);
  const relationDiagnostics = project.diagnostics.filter((diagnostic) => diagnostic.code === 'SCHEMA_RELATION_TARGET_MISSING');

  assert.equal(relationDiagnostics.length, 1);
  assert.equal(relationDiagnostics[0].severity, 'error');
  assert.equal(relationDiagnostics[0].resource, 'posts');
  assert.equal(relationDiagnostics[0].field, 'authorId');
  assert.match(relationDiagnostics[0].message, /missing_author/);
});

test('schema validation reports relation metadata on non-scalar source fields', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'authors.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true }
    },
    "seed": []
  }`);
  await writeFixture(cwd, 'posts.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "authorIds": {
        "type": "array",
        "items": { "type": "string" },
        "relation": {
          "name": "authors",
          "to": "authors",
          "toField": "id",
          "cardinality": "one"
        }
      }
    },
    "seed": [
      { "id": "p_1", "authorIds": ["a_1"] }
    ]
  }`);

  const config = await loadConfig({ cwd });
  const project = await loadProjectSchema(config);
  const relationDiagnostics = project.diagnostics.filter((diagnostic) => diagnostic.code === 'SCHEMA_RELATION_SOURCE_FIELD_INVALID');

  assert.equal(relationDiagnostics.length, 1);
  assert.equal(relationDiagnostics[0].severity, 'error');
  assert.equal(relationDiagnostics[0].resource, 'posts');
  assert.equal(relationDiagnostics[0].field, 'authorIds');
  assert.match(relationDiagnostics[0].message, /posts relation "authors" source field "authorIds" must be a scalar field/);
  assert.match(relationDiagnostics[0].hint, /Use a scalar id field/);
  assert.deepEqual(relationDiagnostics[0].details, {
    relation: {
      name: 'authors',
      sourceResource: 'posts',
      sourceField: 'authorIds',
      targetResource: 'authors',
      targetField: 'id',
      cardinality: 'one',
    },
    sourceFieldType: 'array',
  });
});

test('doctor suggests likely relations without changing schema shape', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: '1', name: 'Ada Lovelace' },
  ]));
  await writeFixture(cwd, 'todos.json', JSON.stringify([
    { id: 't_1', title: 'Ship prototype', userId: '1' },
  ]));

  const config = await loadConfig({ cwd });
  const result = await runJsonDbDoctor(config);
  const project = await loadProjectSchema(config);
  const suggestion = result.findings.find((finding) => finding.code === 'DOCTOR_RELATION_SUGGESTION');

  assert.equal(suggestion.severity, 'info');
  assert.equal(suggestion.resource, 'todos');
  assert.equal(suggestion.field, 'userId');
  assert.match(suggestion.message, /todos\.userId -> users\.id/);
  assert.deepEqual(suggestion.details.suggestedRelation, {
    name: 'user',
    to: 'users',
    toField: 'id',
    cardinality: 'one',
  });
  assert.deepEqual(project.schema.resources.todos.relations, []);
});

test('doctor does not suggest missing relation targets when every duplicated value is missing', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: 'u_1', name: 'Ada Lovelace' },
  ]));
  await writeFixture(cwd, 'todos.json', JSON.stringify([
    { id: 't_1', title: 'First', userId: 'missing' },
    { id: 't_2', title: 'Second', userId: 'missing' },
  ]));

  const config = await loadConfig({ cwd });
  const result = await runJsonDbDoctor(config);

  assert.equal(result.findings.some((finding) => finding.code === 'DOCTOR_RELATION_MISSING_TARGET_VALUES'), false);
  assert.equal(result.findings.some((finding) => finding.code === 'DOCTOR_RELATION_SUGGESTION'), false);
});

test('doctor reports duplicate ids and inconsistent field types', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'todos.json', JSON.stringify([
    { id: 't_1', title: 'One', done: true },
    { id: 't_1', title: 'Two', done: 'yes' },
    { id: 3, title: 'Three', done: false },
  ]));

  const config = await loadConfig({ cwd });
  const result = await runJsonDbDoctor(config);

  assert.equal(result.summary.warn, 3);
  assert.equal(result.summary.error, 0);
  assert.equal(result.findings.some((finding) => finding.code === 'DOCTOR_DUPLICATE_ID'), true);
  assert.equal(result.findings.some((finding) => finding.code === 'DOCTOR_MIXED_ID_TYPES'), true);
  assert.equal(result.findings.some((finding) => finding.code === 'DOCTOR_INCONSISTENT_FIELD_TYPES' && finding.field === 'done'), true);
});

test('doctor validates configured fork folders', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));
  await writeConfig(cwd, `export default {
    forks: ['legacy-demo', '../unsafe'],
  };`);

  const config = await loadConfig({ cwd });
  const result = await runJsonDbDoctor(config);

  assert.equal(result.summary.error, 2);
  assert.equal(result.findings.some((finding) => finding.code === 'FORK_SOURCE_MISSING' && finding.details?.fork === 'legacy-demo'), true);
  assert.equal(result.findings.some((finding) => finding.code === 'FORK_NAME_INVALID' && finding.details?.fork === '../unsafe'), true);
});

test('doctor CLI supports json output and strict check alias', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'todos.json', JSON.stringify([
    { id: 't_1', done: true },
    { id: 't_1', done: 'yes' },
  ]));

  const { stdout } = await execFileAsync(process.execPath, ['./src/cli.js', 'doctor', '--json', '--cwd', cwd], {
    cwd: path.resolve('.'),
  });
  const result = JSON.parse(stdout);

  assert.equal(result.findings.some((finding) => finding.code === 'DOCTOR_DUPLICATE_ID'), true);
  await assert.rejects(
    () => execFileAsync(process.execPath, ['./src/cli.js', 'check', '--strict', '--cwd', cwd], {
      cwd: path.resolve('.'),
    }),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stdout, /DOCTOR_DUPLICATE_ID/);
      return true;
    },
  );
});

test('.schema.mjs helpers expose nullable datetime and flexible objects', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'charts.schema.mjs', `
import { collection, field } from 'jsondb/schema';

export default collection({
  idField: 'id',
  fields: {
    id: field.string({ required: true }),
    ownerPersonId: field.nullable(field.string()),
    lastViewedAt: field.datetime(),
    schemaSnapshot: field.object({
      version: field.number(),
    }, { additionalProperties: true }),
  },
  seed: [
    {
      id: 'chart_1',
      ownerPersonId: null,
      lastViewedAt: '2026-05-11T12:00:00.000Z',
      schemaSnapshot: {
        version: 1,
        displayOverrides: { color: 'green' },
      },
    },
  ],
});
`);

  const config = await loadConfig({ cwd });
  const result = await syncJsonFixtureDb(config);
  const generated = await readFile(path.join(cwd, '.jsondb/types/index.ts'), 'utf8');

  assert.deepEqual(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'), []);
  assert.match(generated, /ownerPersonId\?: string \| null;/);
  assert.match(generated, /lastViewedAt\?: string;/);
  assert.match(generated, /\[key: string\]: unknown;/);
});

test('schema-only fixtures can generate synthetic seed records', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    seed: {
      generateFromSchema: true,
      generatedCount: 3,
    },
  };`);
  await writeFixture(cwd, 'users.schema.json', JSON.stringify({
    kind: 'collection',
    idField: 'id',
    fields: {
      id: { type: 'string', required: true },
      name: { type: 'string', required: true },
      role: { type: 'enum', values: ['admin', 'user'] },
      active: { type: 'boolean' },
    },
    seed: [],
  }));

  const config = await loadConfig({ cwd });
  await syncJsonFixtureDb(config);
  const state = JSON.parse(await readFile(path.join(cwd, '.jsondb/state/users.json'), 'utf8'));

  assert.equal(state.length, 3);
  assert.equal(state[0].id, '1');
  assert.equal(state[0].name, 'name_1');
  assert.equal(state[0].role, 'admin');
  assert.equal(state[1].role, 'user');
});

test('.schema.json files load as schema sources', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.json', JSON.stringify({
    kind: 'collection',
    idField: 'id',
    fields: {
      id: { type: 'string', required: true },
      name: { type: 'string', required: true },
    },
    seed: [],
  }));

  const config = await loadConfig({ cwd });
  const project = await loadProjectSchema(config);
  const users = project.resources.find((resource) => resource.name === 'users');

  assert.equal(project.schema.resources.users.kind, 'collection');
  assert.equal(users.schemaSource, 'json');
  assert.match(users.schemaPath, /users\.schema\.json$/);
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
  await writeFixture(cwd, 'users.schema.mjs', `import { collection, field } from 'jsondb/schema';

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

test('CSV fixtures infer schema and refresh runtime state when the source hash changes', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.csv', [
    'id,name,active,score,zip',
    'u_1,Ada Lovelace,true,10,02139',
    'u_2,Grace Hopper,false,11.5,10001',
  ].join('\n'));

  const config = await loadConfig({ cwd });
  const firstSync = await syncJsonFixtureDb(config);
  const statePath = path.join(cwd, '.jsondb/state/users.json');
  const metadataPath = path.join(cwd, '.jsondb/state/.sources.json');

  assert.equal(firstSync.schema.resources.users.kind, 'collection');
  assert.equal(firstSync.schema.resources.users.idField, 'id');
  assert.equal(firstSync.schema.resources.users.fields.active.type, 'boolean');
  assert.equal(firstSync.schema.resources.users.fields.score.type, 'number');
  assert.equal(firstSync.schema.resources.users.fields.zip.type, 'string');
  assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), [
    {
      id: 'u_1',
      name: 'Ada Lovelace',
      active: true,
      score: 10,
      zip: '02139',
    },
    {
      id: 'u_2',
      name: 'Grace Hopper',
      active: false,
      score: 11.5,
      zip: '10001',
    },
  ]);

  await writeFile(statePath, `${JSON.stringify([{ id: 'runtime_edit', name: 'Runtime Edit' }], null, 2)}\n`);
  await syncJsonFixtureDb(config);
  assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), [
    {
      id: 'runtime_edit',
      name: 'Runtime Edit',
    },
  ]);

  await writeFixture(cwd, 'users.csv', [
    'id,name,active,score,zip',
    'u_3,Linus Torvalds,true,99,00901',
  ].join('\n'));
  await syncJsonFixtureDb(config);

  assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), [
    {
      id: 'u_3',
      name: 'Linus Torvalds',
      active: true,
      score: 99,
      zip: '00901',
    },
  ]);

  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  assert.equal(metadata.resources.users.format, 'csv');
  assert.equal(metadata.resources.users.path, 'db/users.csv');
  assert.match(metadata.resources.users.hash, /^[a-f0-9]{64}$/);
});

test('JSON fixture hashes refresh mirror state only when the source file changes', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
    },
    {
      name: 'Grace Hopper',
      email: 'grace@example.com',
    },
  ]));

  const config = await loadConfig({ cwd });
  const firstSync = await syncJsonFixtureDb(config);
  const statePath = path.join(cwd, '.jsondb/state/users.json');
  const metadataPath = path.join(cwd, '.jsondb/state/.sources.json');

  assert.equal(firstSync.schema.resources.users.fields.id.type, 'string');
  assert.equal(firstSync.schema.resources.users.fields.id.required, true);
  assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), [
    {
      id: '1',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
    },
    {
      id: '2',
      name: 'Grace Hopper',
      email: 'grace@example.com',
    },
  ]);
  assert.doesNotMatch(await readFile(path.join(cwd, 'db/users.json'), 'utf8'), /"id"/);

  await writeFile(statePath, `${JSON.stringify([{ id: 'runtime_edit', name: 'Runtime Edit' }], null, 2)}\n`);
  await syncJsonFixtureDb(config);
  assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), [
    {
      id: 'runtime_edit',
      name: 'Runtime Edit',
    },
  ]);

  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      name: 'Linus Torvalds',
      email: 'linus@example.com',
    },
  ]));
  await syncJsonFixtureDb(config);

  assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), [
    {
      id: '1',
      name: 'Linus Torvalds',
      email: 'linus@example.com',
    },
  ]);

  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  assert.equal(metadata.resources.users.format, 'json');
  assert.equal(metadata.resources.users.path, 'db/users.json');
  assert.match(metadata.resources.users.hash, /^[a-f0-9]{64}$/);
});

test('non-mirror sync writes generated ids back to JSON fixtures', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    sourceDir: './db',
    stateDir: './.jsondb',
    mode: 'source'
  };`);
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      name: 'Ada Lovelace'
    },
    {
      id: '10',
      name: 'Grace Hopper'
    },
    {
      name: 'Katherine Johnson'
    }
  ]));

  const config = await loadConfig({ cwd });
  await syncJsonFixtureDb(config);

  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, 'db/users.json'), 'utf8')), [
    {
      id: '11',
      name: 'Ada Lovelace',
    },
    {
      id: '10',
      name: 'Grace Hopper',
    },
    {
      id: '12',
      name: 'Katherine Johnson',
    },
  ]);
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

test('source load errors report the file and keep other resources available when allowed', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));
  await writeFixture(cwd, 'broken.json', '{"id": ');

  const config = await loadConfig({ cwd });
  const project = await syncJsonFixtureDb(config, { allowErrors: true });

  assert.deepEqual(Object.keys(project.schema.resources), ['users']);
  assert.equal(project.diagnostics[0].code, 'SOURCE_LOAD_FAILED');
  assert.equal(project.diagnostics[0].file, 'db/broken.json');
  assert.match(project.diagnostics[0].message, /Could not load db\/broken\.json/);
  assert.match(await readFile(path.join(cwd, '.jsondb/schema.generated.json'), 'utf8'), /SOURCE_LOAD_FAILED/);
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

test('schema-backed CSV arrays stay arrays in the runtime mirror', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'charts.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "tags": {
        "type": "array",
        "items": { "type": "string" }
      }
    }
  }`);
  await writeFixture(cwd, 'charts.csv', 'id,tags\nchart_1,renewal;priority\nchart_2,"[""growth"",""upsell""]"');

  const config = await loadConfig({ cwd });
  const result = await syncJsonFixtureDb(config);
  const state = JSON.parse(await readFile(path.join(cwd, '.jsondb/state/charts.json'), 'utf8'));

  assert.deepEqual(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'), []);
  assert.deepEqual(state, [
    {
      id: 'chart_1',
      tags: ['renewal', 'priority'],
    },
    {
      id: 'chart_2',
      tags: ['growth', 'upsell'],
    },
  ]);
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
