import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { syncJsonFixtureDb, loadConfig, loadProjectSchema, generateTypes } from '../../src/index.js';
import { makeProject, writeConfig, writeFixture } from '../helpers.js';

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

test('custom source readers can load data files with source context helpers', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    sources: {
      readers: [
        {
          name: 'pipe-data',
          match({ file }) {
            return file.endsWith('.pipe');
          },
          async read({ file, sourceFile, filename, extension, config, hash, readText, readBuffer }) {
            if (file !== 'db/users.pipe' || filename !== 'users.pipe' || extension !== '.pipe') {
              throw new Error('unexpected source context');
            }
            if (!sourceFile.endsWith('/db/users.pipe') || !config.cwd) {
              throw new Error('missing absolute source context');
            }
            const text = await readText();
            const buffer = await readBuffer();
            if (buffer.length !== Buffer.byteLength(text) || !/^[a-f0-9]{64}$/.test(hash)) {
              throw new Error('missing source helpers');
            }
            return {
              kind: 'data',
              resourceName: 'users',
              format: 'pipe',
              data: text.trim().split('\\n').map((line) => {
                const [id, name] = line.split('|');
                return { id, name };
              }),
            };
          },
        },
      ],
    },
  };`);
  await writeFixture(cwd, 'users.pipe', 'u_1|Ada Lovelace');

  const config = await loadConfig({ cwd });
  const result = await syncJsonFixtureDb(config);

  assert.equal(result.schema.resources.users.kind, 'collection');
  assert.equal(result.schema.resources.users.fields.name.type, 'string');
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, '.jsondb/state/users.json'), 'utf8')), [
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ]);
  const metadata = JSON.parse(await readFile(path.join(cwd, '.jsondb/state/.sources.json'), 'utf8'));
  assert.equal(metadata.resources.users.format, 'pipe');
  assert.equal(metadata.resources.users.path, 'db/users.pipe');
});

test('custom source readers can load schema sources', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    sources: {
      readers: [
        {
          name: 'model-schema',
          match({ file }) {
            return file.endsWith('.model');
          },
          read() {
            return {
              kind: 'schema',
              resourceName: 'users',
              format: 'model',
              schema: {
                kind: 'collection',
                idField: 'id',
                fields: {
                  id: { type: 'string', required: true },
                  email: { type: 'string', required: true },
                  role: { type: 'enum', values: ['admin', 'user'], default: 'user' },
                },
                seed: [
                  { id: 'u_1', email: 'ada@example.com' },
                ],
              },
            };
          },
        },
      ],
    },
  };`);
  await writeFixture(cwd, 'users.model', 'collection users');

  const config = await loadConfig({ cwd });
  const result = await syncJsonFixtureDb(config);
  const users = result.resources.find((resource) => resource.name === 'users');

  assert.equal(users.schemaSource, 'model');
  assert.equal(result.schema.resources.users.fields.role.default, 'user');
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, '.jsondb/state/users.json'), 'utf8')), [
    {
      id: 'u_1',
      email: 'ada@example.com',
      role: 'user',
    },
  ]);
});

test('custom source readers run before built-in readers and can override them', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    sources: {
      readers: [
        {
          name: 'json-override',
          match({ file }) {
            return file === 'db/users.json';
          },
          async read({ readText }) {
            const text = await readText();
            const [id, name] = text.trim().split('|');
            return {
              kind: 'data',
              resourceName: 'users',
              format: 'pipe-json',
              data: [{ id, name }],
            };
          },
        },
      ],
    },
  };`);
  await writeFixture(cwd, 'users.json', 'u_1|Override JSON');

  const config = await loadConfig({ cwd });
  await syncJsonFixtureDb(config);

  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, '.jsondb/state/users.json'), 'utf8')), [
    {
      id: 'u_1',
      name: 'Override JSON',
    },
  ]);
});

test('custom source readers can return multiple named sources from one file', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    sources: {
      readers: [
        {
          name: 'bundle',
          match({ file }) {
            return file.endsWith('.bundle');
          },
          read() {
            return [
              {
                kind: 'data',
                resourceName: 'users',
                format: 'bundle',
                data: [{ id: 'u_1', name: 'Ada' }],
              },
              {
                kind: 'schema',
                resourceName: 'settings',
                format: 'bundle',
                schema: {
                  kind: 'document',
                  fields: {
                    theme: { type: 'string', default: 'light' },
                  },
                  seed: {},
                },
              },
            ];
          },
        },
      ],
    },
  };`);
  await writeFixture(cwd, 'app.bundle', 'bundle content');

  const config = await loadConfig({ cwd });
  const result = await syncJsonFixtureDb(config);

  assert.deepEqual(Object.keys(result.schema.resources), ['settings', 'users']);
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, '.jsondb/state/users.json'), 'utf8')), [
    {
      id: 'u_1',
      name: 'Ada',
    },
  ]);
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, '.jsondb/state/settings.json'), 'utf8')), {
    theme: 'light',
  });
});

test('custom multi-source readers must name every returned source', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    sources: {
      readers: [
        {
          name: 'bad-bundle',
          match({ file }) {
            return file.endsWith('.bundle');
          },
          read() {
            return [
              {
                kind: 'data',
                resourceName: 'users',
                data: [{ id: 'u_1' }],
              },
              {
                kind: 'data',
                data: [{ id: 'p_1' }],
              },
            ];
          },
        },
      ],
    },
  };`);
  await writeFixture(cwd, 'app.bundle', 'bundle content');

  const config = await loadConfig({ cwd });

  await assert.rejects(
    () => syncJsonFixtureDb(config),
    (error) => {
      assert.equal(error.diagnostics?.[0]?.code, 'SOURCE_READER_RESOURCE_NAME_REQUIRED');
      assert.equal(error.diagnostics[0].file, 'db/app.bundle');
      assert.match(error.diagnostics[0].message, /bad-bundle/);
      assert.match(error.diagnostics[0].hint, /resourceName/);
      return true;
    },
  );
});
