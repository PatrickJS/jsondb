import path from 'node:path';
import { jsonDbError } from '../errors.js';
import { writeText } from '../fs-utils.js';
import { routePathForResource } from '../names.js';
import { loadProjectSchema } from '../schema.js';

const DEFAULT_OPTIONS = {
  outDir: './jsondb-api',
  api: ['rest'],
  db: 'sqlite',
  app: 'standalone',
  runtime: 'node-sqlite',
  seed: false,
  allowWarnings: false,
};

export async function generateHonoStarter(config, options = {}) {
  const resolved = resolveGenerateOptions(config, options);
  const project = await loadProjectSchema(config);
  assertGeneratable(project, resolved);

  const files = renderHonoStarter(project, resolved);
  for (const file of files) {
    await writeText(path.join(resolved.outDir, file.path), file.content);
  }

  return {
    outDir: resolved.outDir,
    files: files.map((file) => path.join(resolved.outDir, file.path)),
    diagnostics: project.diagnostics,
  };
}

export function renderHonoStarter(project, options = {}) {
  const resolved = {
    ...DEFAULT_OPTIONS,
    ...options,
    api: normalizeApi(options.api ?? DEFAULT_OPTIONS.api),
  };
  const files = [
    generatedFile('src/schema.ts', renderGeneratedSchema(project)),
    generatedFile('src/repository.ts', renderRepositoryTypes()),
    generatedFile('src/validators.ts', renderValidators()),
    generatedFile('src/sqlite.ts', renderSqliteAdapter(project, resolved)),
    generatedFile('migrations/0001_initial.sql', renderInitialMigration(project.resources)),
    generatedFile('README.md', renderReadme(project, resolved)),
  ];

  if (resolved.seed === 'fixtures') {
    files.push(generatedFile('src/seed.ts', renderSeedModule()));
  }

  if (resolved.api.includes('rest')) {
    files.push(generatedFile('src/rest.ts', renderRestRoutes()));
  }

  if (resolved.api.includes('graphql')) {
    files.push(generatedFile('src/graphql.ts', renderGraphqlRoutes(project)));
  }

  if (resolved.api.length > 0) {
    files.push(generatedFile('src/app.ts', renderHonoApp(resolved)));
  }

  if (resolved.app === 'standalone') {
    files.push(
      generatedFile('src/server.ts', renderServerEntry()),
      generatedFile('package.json', renderPackageJson(resolved)),
      generatedFile('tsconfig.json', renderTsconfig()),
    );
  }

  return files;
}

function resolveGenerateOptions(config, options) {
  const fromConfig = config.generate?.hono ?? {};
  const definedOptions = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
  const merged = {
    ...DEFAULT_OPTIONS,
    ...fromConfig,
    ...definedOptions,
  };
  merged.api = normalizeApi(merged.api);
  merged.outDir = path.resolve(config.cwd, merged.outDir ?? merged.out ?? DEFAULT_OPTIONS.outDir);
  merged.db = merged.db ?? 'sqlite';
  merged.app = merged.app ?? 'standalone';
  merged.runtime = merged.runtime ?? 'node-sqlite';
  merged.seed = merged.seed === true ? 'fixtures' : merged.seed;

  if (merged.db !== 'sqlite') {
    throw jsonDbError(
      'GENERATE_UNSUPPORTED_DB',
      `Unsupported generated database "${merged.db}".`,
      {
        hint: 'Use --db sqlite for the v1 generator.',
        details: {
          db: merged.db,
        },
      },
    );
  }

  if (!['standalone', 'module'].includes(merged.app)) {
    throw jsonDbError(
      'GENERATE_UNSUPPORTED_APP_SHAPE',
      `Unsupported generated app shape "${merged.app}".`,
      {
        hint: 'Use --app standalone or --app module.',
        details: {
          app: merged.app,
        },
      },
    );
  }

  return merged;
}

function normalizeApi(value) {
  const raw = Array.isArray(value) ? value : String(value ?? 'rest').split(',');
  const api = raw.map((item) => String(item).trim()).filter(Boolean);
  if (api.length === 1 && api[0] === 'none') {
    return [];
  }

  const unsupported = api.filter((item) => !['rest', 'graphql'].includes(item));
  if (unsupported.length > 0) {
    throw jsonDbError(
      'GENERATE_UNSUPPORTED_API',
      `Unsupported generated API target "${unsupported[0]}".`,
      {
        hint: 'Use --api rest, --api graphql, --api rest,graphql, or --api none.',
        details: {
          api,
        },
      },
    );
  }

  return [...new Set(api)];
}

function assertGeneratable(project, options) {
  const errors = project.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  const warnings = project.diagnostics.filter((diagnostic) => diagnostic.severity === 'warn');
  const blocking = options.allowWarnings ? errors : [...errors, ...warnings];

  if (blocking.length === 0) {
    return;
  }

  const error = jsonDbError(
    'GENERATE_SCHEMA_DIAGNOSTICS',
    `Cannot generate Hono starter because schema diagnostics are present: ${blocking[0].message}`,
    {
      hint: options.allowWarnings
        ? 'Fix schema errors before generating production starter code.'
        : 'Fix schema warnings/errors, or pass --allow-warnings to generate while keeping warning diagnostics.',
      details: {
        diagnostics: blocking,
      },
    },
  );
  error.diagnostics = blocking;
  throw error;
}

function renderGeneratedSchema(project) {
  return [
    generatedHeader(),
    `export const resources = ${JSON.stringify(project.schema.resources, null, 2)} as const;`,
    '',
    `export const seedData = ${JSON.stringify(Object.fromEntries(project.resources.map((resource) => [resource.name, resource.seed])), null, 2)} as const;`,
    '',
    'export type ResourceName = keyof typeof resources;',
  ].join('\n');
}

function renderRepositoryTypes() {
  return `${generatedHeader()}
export type CollectionRepository = {
  all(): Promise<Record<string, unknown>[]>;
  get(id: string): Promise<Record<string, unknown> | null>;
  create(record: Record<string, unknown>): Promise<Record<string, unknown>>;
  patch(id: string, patch: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  delete(id: string): Promise<boolean>;
};

export type DocumentRepository = {
  all(): Promise<Record<string, unknown>>;
  put(value: Record<string, unknown>): Promise<Record<string, unknown>>;
  patch(value: Record<string, unknown>): Promise<Record<string, unknown>>;
};

export type JsonDbRepository = {
  resources: Record<string, any>;
  collection(name: string): CollectionRepository;
  document(name: string): DocumentRepository;
  close?(): void;
};
`;
}

function renderValidators() {
  return `${generatedHeader()}
import { resources } from './schema.js';

export function applyDefaults(resourceName: string, value: Record<string, unknown>) {
  const resource = requireResource(resourceName);
  const next = { ...value };
  for (const [fieldName, field] of Object.entries<any>(resource.fields || {})) {
    if (next[fieldName] === undefined && 'default' in field) {
      next[fieldName] = structuredClone(field.default);
    }
  }
  return next;
}

export function stripUnknownFields(resourceName: string, value: Record<string, unknown>) {
  const resource = requireResource(resourceName);
  const next: Record<string, unknown> = {};
  for (const fieldName of Object.keys(resource.fields || {})) {
    if (value[fieldName] !== undefined) {
      next[fieldName] = value[fieldName];
    }
  }
  return next;
}

export function validateRecord(resourceName: string, value: Record<string, unknown>) {
  const resource = requireResource(resourceName);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw validationError(resourceName, 'Record must be a JSON object.');
  }

  for (const [fieldName, field] of Object.entries<any>(resource.fields || {})) {
    const fieldValue = value[fieldName];
    if (field.required && (fieldValue === undefined || (fieldValue === null && !field.nullable))) {
      throw validationError(resourceName, 'Missing required field "' + fieldName + '".');
    }
    if (fieldValue !== undefined) {
      validateValue(resourceName, fieldName, field, fieldValue);
    }
  }
}

function validateValue(resourceName: string, fieldPath: string, field: any, value: unknown) {
  if (value === null && field.type !== 'unknown' && !field.nullable) {
    throw validationError(resourceName, 'Field "' + fieldPath + '" cannot be null.');
  }

  if (value === null) {
    return;
  }

  if (field.type === 'unknown') {
    return;
  }
  if ((field.type === 'string' || field.type === 'datetime') && typeof value !== 'string') {
    throw validationError(resourceName, 'Field "' + fieldPath + '" must be a string.');
  }
  if (field.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
    throw validationError(resourceName, 'Field "' + fieldPath + '" must be a finite number.');
  }
  if (field.type === 'boolean' && typeof value !== 'boolean') {
    throw validationError(resourceName, 'Field "' + fieldPath + '" must be a boolean.');
  }
  if (field.type === 'enum' && !field.values?.includes(value)) {
    throw validationError(resourceName, 'Field "' + fieldPath + '" must be one of: ' + (field.values || []).join(', ') + '.');
  }
  if (field.type === 'array') {
    if (!Array.isArray(value)) {
      throw validationError(resourceName, 'Field "' + fieldPath + '" must be an array.');
    }
    value.forEach((item, index) => validateValue(resourceName, fieldPath + '[' + index + ']', field.items || { type: 'unknown' }, item));
  }
  if (field.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw validationError(resourceName, 'Field "' + fieldPath + '" must be an object.');
    }
    for (const [childName, childField] of Object.entries<any>(field.fields || {})) {
      const childValue = (value as Record<string, unknown>)[childName];
      if (childField.required && (childValue === undefined || (childValue === null && !childField.nullable))) {
        throw validationError(resourceName, 'Missing required field "' + fieldPath + '.' + childName + '".');
      }
      if (childValue !== undefined) {
        validateValue(resourceName, fieldPath + '.' + childName, childField, childValue);
      }
    }
  }
}

function requireResource(resourceName: string) {
  const resource = (resources as Record<string, any>)[resourceName];
  if (!resource) {
    throw validationError(resourceName, 'Unknown resource "' + resourceName + '".');
  }
  return resource;
}

function validationError(resourceName: string, message: string) {
  const error = new Error(resourceName + ': ' + message) as Error & { status?: number; code?: string };
  error.status = 400;
  error.code = 'VALIDATION_FAILED';
  return error;
}
`;
}

function renderSqliteAdapter(project, options) {
  const seedImport = options.seed === 'fixtures' ? "import { seedData } from './schema.js';\n" : '';
  const seedCall = options.seed === 'fixtures' ? '\n  seedFixtures(db);\n' : '';
  const seedFunction = options.seed === 'fixtures' ? `
function seedFixtures(db: DatabaseSync) {
  for (const [resourceName, seed] of Object.entries<any>(seedData)) {
    const resource = (resources as Record<string, any>)[resourceName];
    if (!resource) {
      continue;
    }
    if (resource.kind === 'collection') {
      const count = db.prepare('SELECT COUNT(*) as count FROM ' + quoteIdentifier(resourceName)).get() as { count: number };
      if (count.count > 0) {
        continue;
      }
      const collection = collectionRepository(db, resourceName);
      for (const record of seed) {
        collection.create(record);
      }
    } else {
      const existing = db.prepare('SELECT name FROM _jsondb_documents WHERE name = ?').get(resourceName);
      if (!existing) {
        documentRepository(db, resourceName).put(seed);
      }
    }
  }
}
` : '';

  return `${generatedHeader()}
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { resources } from './schema.js';
${seedImport}import type { CollectionRepository, DocumentRepository, JsonDbRepository } from './repository.js';
import { applyDefaults, stripUnknownFields, validateRecord } from './validators.js';

export function openSqliteRepository(file = process.env.DATABASE_FILE || './data/app.sqlite'): JsonDbRepository {
  if (file !== ':memory:') {
    mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file);
  migrate(db);${seedCall}
  return {
    resources,
    collection(name: string) {
      return collectionRepository(db, name);
    },
    document(name: string) {
      return documentRepository(db, name);
    },
    close() {
      db.close();
    },
  };
}

export function migrate(db: DatabaseSync) {
${renderMigrationExecLines(project.resources)}
}

function collectionRepository(db: DatabaseSync, resourceName: string): CollectionRepository {
  const resource = requireResource(resourceName, 'collection');
  const table = quoteIdentifier(resourceName);
  const fields = Object.keys(resource.fields);
  const idField = resource.idField || 'id';

  return {
    async all() {
      return (db.prepare('SELECT * FROM ' + table).all() as Record<string, unknown>[]).map((row) => deserializeRow(resourceName, row));
    },
    async get(id) {
      const row = db.prepare('SELECT * FROM ' + table + ' WHERE ' + quoteIdentifier(idField) + ' = ?').get(String(id)) as Record<string, unknown> | undefined;
      return row ? deserializeRow(resourceName, row) : null;
    },
    async create(record) {
      const next = applyDefaults(resourceName, stripUnknownFields(resourceName, { ...record }));
      if (next[idField] === undefined || next[idField] === null || next[idField] === '') {
        next[idField] = nextId(db, table, idField);
      }
      validateRecord(resourceName, next);
      const serialized = serializeRow(resourceName, next);
      const columns = fields.map(quoteIdentifier).join(', ');
      const placeholders = fields.map(() => '?').join(', ');
      db.prepare('INSERT INTO ' + table + ' (' + columns + ') VALUES (' + placeholders + ')').run(...fields.map((field) => serialized[field] ?? null));
      return next;
    },
    async patch(id, patch) {
      const existing = await this.get(id);
      if (!existing) {
        return null;
      }
      const next = applyDefaults(resourceName, stripUnknownFields(resourceName, { ...existing, ...patch, [idField]: existing[idField] }));
      validateRecord(resourceName, next);
      const serialized = serializeRow(resourceName, next);
      const updateFields = fields.filter((field) => field !== idField);
      const assignments = updateFields.map((field) => quoteIdentifier(field) + ' = ?').join(', ');
      db.prepare('UPDATE ' + table + ' SET ' + assignments + ' WHERE ' + quoteIdentifier(idField) + ' = ?').run(...updateFields.map((field) => serialized[field] ?? null), String(id));
      return next;
    },
    async delete(id) {
      const result = db.prepare('DELETE FROM ' + table + ' WHERE ' + quoteIdentifier(idField) + ' = ?').run(String(id));
      return result.changes > 0;
    },
  };
}

function documentRepository(db: DatabaseSync, resourceName: string): DocumentRepository {
  requireResource(resourceName, 'document');
  return {
    async all() {
      const row = db.prepare('SELECT value FROM _jsondb_documents WHERE name = ?').get(resourceName) as { value: string } | undefined;
      return row ? JSON.parse(row.value) : {};
    },
    async put(value) {
      const next = applyDefaults(resourceName, stripUnknownFields(resourceName, value));
      validateRecord(resourceName, next);
      db.prepare('INSERT INTO _jsondb_documents (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value').run(resourceName, JSON.stringify(next));
      return next;
    },
    async patch(value) {
      const existing = await this.all();
      return this.put({ ...existing, ...value });
    },
  };
}

function serializeRow(resourceName: string, record: Record<string, unknown>) {
  const resource = requireResource(resourceName, 'collection');
  const row: Record<string, unknown> = {};
  for (const [fieldName, field] of Object.entries<any>(resource.fields)) {
    const value = record[fieldName];
    if (value === undefined) {
      row[fieldName] = null;
    } else if (field.type === 'boolean') {
      row[fieldName] = value ? 1 : 0;
    } else if (field.type === 'object' || field.type === 'array' || field.type === 'unknown') {
      row[fieldName] = JSON.stringify(value);
    } else {
      row[fieldName] = value;
    }
  }
  return row;
}

function deserializeRow(resourceName: string, row: Record<string, unknown>) {
  const resource = requireResource(resourceName, 'collection');
  const record: Record<string, unknown> = {};
  for (const [fieldName, field] of Object.entries<any>(resource.fields)) {
    const value = row[fieldName];
    if (value === null || value === undefined) {
      continue;
    }
    if (field.type === 'boolean') {
      record[fieldName] = Boolean(value);
    } else if (field.type === 'object' || field.type === 'array' || field.type === 'unknown') {
      record[fieldName] = typeof value === 'string' ? JSON.parse(value) : value;
    } else {
      record[fieldName] = value;
    }
  }
  return record;
}

function nextId(db: DatabaseSync, table: string, idField: string) {
  const rows = db.prepare('SELECT ' + quoteIdentifier(idField) + ' as id FROM ' + table).all() as Array<{ id: string }>;
  const ids = rows.map((row) => String(row.id)).filter(Boolean);
  const numeric = ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0);
  let next = numeric.length > 0 ? Math.max(...numeric) + 1 : ids.length + 1;
  while (ids.includes(String(next))) {
    next += 1;
  }
  return String(next);
}

function requireResource(resourceName: string, kind: 'collection' | 'document') {
  const resource = (resources as Record<string, any>)[resourceName];
  if (!resource || resource.kind !== kind) {
    throw new Error('Unknown ' + kind + ' resource "' + resourceName + '".');
  }
  return resource;
}

function quoteIdentifier(value: string) {
  return '"' + String(value).replaceAll('"', '""') + '"';
}
${seedFunction}`;
}

function renderRestRoutes() {
  return `${generatedHeader()}
import type { Hono } from 'hono';
import type { JsonDbRepository } from './repository.js';
import { resources } from './schema.js';

export function registerRestRoutes(app: Hono, repository: JsonDbRepository) {
  for (const [resourceName, resource] of Object.entries<any>(resources)) {
    if (resource.kind === 'collection') {
      app.get(resource.routePath, async (c) => c.json(await repository.collection(resourceName).all()));
      app.get(resource.routePath + '/:id', async (c) => {
        const record = await repository.collection(resourceName).get(c.req.param('id'));
        return record ? c.json(record) : c.json({ error: 'Not found' }, 404);
      });
      app.post(resource.routePath, async (c) => {
        const record = await repository.collection(resourceName).create(await c.req.json());
        return c.json(record, 201);
      });
      app.patch(resource.routePath + '/:id', async (c) => {
        const record = await repository.collection(resourceName).patch(c.req.param('id'), await c.req.json());
        return record ? c.json(record) : c.json({ error: 'Not found' }, 404);
      });
      app.delete(resource.routePath + '/:id', async (c) => {
        const deleted = await repository.collection(resourceName).delete(c.req.param('id'));
        return deleted ? c.body(null, 204) : c.json({ error: 'Not found' }, 404);
      });
    } else {
      app.get(resource.routePath, async (c) => c.json(await repository.document(resourceName).all()));
      app.put(resource.routePath, async (c) => c.json(await repository.document(resourceName).put(await c.req.json())));
      app.patch(resource.routePath, async (c) => c.json(await repository.document(resourceName).patch(await c.req.json())));
    }
  }
}
`;
}

function renderGraphqlRoutes(project) {
  return `${generatedHeader()}
import type { Hono } from 'hono';
import { executeGraphql } from 'jsondb';
import type { JsonDbRepository } from './repository.js';

const graphqlSdl = ${JSON.stringify(project.schema.graphql)};

export function registerGraphqlRoutes(app: Hono, repository: JsonDbRepository, path = '/graphql') {
  app.get(path, (c) => c.text(graphqlSdl));
  app.post(path, async (c) => executeGraphql(createDbFacade(repository), await c.req.json()).then((result) => c.json(result)));
}

function createDbFacade(repository: JsonDbRepository) {
  return {
    resources: new Map(Object.entries(repository.resources)),
    collection(name: string) {
      return repository.collection(name);
    },
    document(name: string) {
      const document = repository.document(name);
      return {
        all: () => document.all(),
        update: (patch: Record<string, unknown>) => document.patch(patch),
        put: (value: Record<string, unknown>) => document.put(value),
        async set(pointer: string, value: unknown) {
          const current = await document.all();
          setPointer(current, pointer, value);
          await document.put(current);
          return value;
        },
      };
    },
  };
}

function setPointer(document: Record<string, unknown>, pointer: string, value: unknown) {
  const parts = pointer.split('/').slice(1).map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
  let current: Record<string, unknown> = document;
  while (parts.length > 1) {
    const part = parts.shift() as string;
    if (!current[part] || typeof current[part] !== 'object' || Array.isArray(current[part])) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[0] || ''] = value;
}
`;
}

function renderHonoApp(options) {
  const imports = [
    "import { Hono } from 'hono';",
    "import { openSqliteRepository } from './sqlite.js';",
  ];
  const registrations = [];
  if (options.api.includes('rest')) {
    imports.push("import { registerRestRoutes } from './rest.js';");
    registrations.push('registerRestRoutes(app, repository);');
  }
  if (options.api.includes('graphql')) {
    imports.push("import { registerGraphqlRoutes } from './graphql.js';");
    registrations.push('registerGraphqlRoutes(app, repository);');
  }

  return `${generatedHeader()}
${imports.join('\n')}

export const repository = openSqliteRepository();
export const app = new Hono();

app.onError((error, c) => {
  const status = typeof (error as any).status === 'number' ? (error as any).status : 500;
  return c.json({
    error: {
      code: (error as any).code || 'SERVER_ERROR',
      message: error.message,
    },
  }, status as any);
});

${registrations.join('\n')}
`;
}

function renderServerEntry() {
  return `${generatedHeader()}
import { serve } from '@hono/node-server';
import { app } from './app.js';

const port = Number(process.env.PORT || 3000);

serve({
  fetch: app.fetch,
  port,
});

console.log('jsondb Hono API listening on http://127.0.0.1:' + port);
`;
}

function renderSeedModule() {
  return `${generatedHeader()}
export { seedData } from './schema.js';
`;
}

function renderPackageJson(options) {
  const dependencies = {
    '@hono/node-server': '^1.13.8',
    hono: '^4.6.0',
  };
  if (options.api.includes('graphql')) {
    dependencies['jsondb'] = '^0.1.0';
  }

  return `${JSON.stringify({
    name: 'jsondb-api',
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      dev: 'tsx watch src/server.ts',
      start: 'node dist/server.js',
      build: 'tsc -p tsconfig.json',
    },
    dependencies,
    devDependencies: {
      '@types/node': '^22.13.0',
      tsx: '^4.19.0',
      typescript: '^5.7.0',
    },
    engines: {
      node: '>=22.13',
    },
  }, null, 2)}\n`;
}

function renderTsconfig() {
  return `${JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      esModuleInterop: true,
      outDir: 'dist',
      rootDir: 'src',
      skipLibCheck: true,
    },
    include: ['src/**/*.ts'],
  }, null, 2)}\n`;
}

function renderReadme(project, options) {
  const apiText = options.api.length === 0 ? 'SQLite repository only' : options.api.join(' + ');
  return `${generatedHeader()}# jsondb Hono API Starter

Generated from jsondb schema resources:

${project.resources.map((resource) => `- ${resource.name} (${resource.kind})`).join('\n')}

## Shape

- API: ${apiText}
- Database: SQLite with node:sqlite
- Runtime: Node.js >=22.13
- Seed fixtures: ${options.seed === 'fixtures' ? 'enabled' : 'disabled'}

## Commands

\`\`\`bash
npm install
npm run dev
\`\`\`

The initial migration is in \`migrations/0001_initial.sql\`. Destructive schema changes should be reviewed manually.
`;
}

function renderInitialMigration(resources) {
  return `${generatedHeader('--')}${resources.map((resource) => (
    resource.kind === 'collection'
      ? createTableSql(resource)
      : null
  )).filter(Boolean).join('\n\n')}

CREATE TABLE IF NOT EXISTS "_jsondb_documents" (
  "name" TEXT PRIMARY KEY,
  "value" TEXT NOT NULL
) STRICT;
`;
}

function renderMigrationExecLines(resources) {
  const sql = renderInitialMigration(resources).split('\n').filter((line) => !line.startsWith('--')).join('\n');
  return `  db.exec(${JSON.stringify(sql)});`;
}

function createTableSql(resource) {
  const columns = Object.entries(resource.fields).map(([fieldName, field]) => {
    const type = sqliteTypeForField(field);
    const primary = fieldName === resource.idField ? ' PRIMARY KEY' : '';
    const required = field.required && fieldName !== resource.idField ? ' NOT NULL' : '';
    return `  ${quoteIdentifier(fieldName)} ${type}${primary}${required}`;
  });

  return `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(resource.name)} (\n${columns.join(',\n')}\n) STRICT;`;
}

function sqliteTypeForField(field) {
  switch (field.type) {
    case 'number':
      return 'REAL';
    case 'boolean':
      return 'INTEGER';
    case 'object':
    case 'array':
    case 'unknown':
      return 'TEXT';
    case 'string':
    case 'enum':
    default:
      return 'TEXT';
  }
}

function generatedFile(filePath, content) {
  return {
    path: filePath,
    content: content.endsWith('\n') ? content : `${content}\n`,
  };
}

function generatedHeader(comment = '//') {
  return `${comment} This file is generated by jsondb. Edit it freely after generation.\n`;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}
