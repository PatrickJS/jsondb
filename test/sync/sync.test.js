import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { syncJsonFixtureDb, loadConfig } from '../../src/index.js';
import { makeProject, writeConfig, writeFixture } from '../helpers.js';

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

test('nested fixture folders are discovered and keep relative source paths', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'db/content'), { recursive: true });
  await writeFile(path.join(cwd, 'db/content/pages.schema.jsonc'), `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "title": { "type": "string", "required": true }
    }
  }\n`, 'utf8');
  await writeFile(path.join(cwd, 'db/content/pages.json'), `${JSON.stringify([
    {
      id: 'home',
      title: 'Home',
    },
  ])}\n`, 'utf8');

  const config = await loadConfig({ cwd });
  const result = await syncJsonFixtureDb(config);
  const metadata = JSON.parse(await readFile(path.join(cwd, '.jsondb/state/.sources.json'), 'utf8'));

  assert.equal(result.schema.resources.pages.kind, 'collection');
  assert.match(result.logs.join('\n'), /Loaded db\/content\/pages\.schema\.jsonc/);
  assert.equal(metadata.resources.pages.path, 'db/content/pages.json');
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, '.jsondb/state/pages.json'), 'utf8')), [
    {
      id: 'home',
      title: 'Home',
    },
  ]);
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
