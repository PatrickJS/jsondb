import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { jsonDbError, listChoices } from '../errors.js';
import { assertRecordMatchesResource, loadProjectSchema } from '../schema.js';
import { applyDefaultsToRecord } from '../sync.js';

export async function openSqliteJsonDb(options = {}) {
  const config = await loadConfig(options);
  const project = options.project ?? await loadProjectSchema(config);
  const storage = options.storage ?? {};
  const file = storage.file ?? options.file ?? path.join(config.stateDir, 'sqlite', 'jsondb.sqlite');
  const { DatabaseSync } = await importNodeSqlite();

  if (file !== ':memory:') {
    await mkdir(path.dirname(file), { recursive: true });
  }

  const database = new DatabaseSync(file);
  migrateSqliteJsonDb(database, project.resources);

  return new SqliteJsonDb(config, project.resources, database);
}

export function migrateSqliteJsonDb(database, resources) {
  for (const resource of resources) {
    if (resource.kind === 'collection') {
      database.exec(createTableSql(resource));
    }
  }

  database.exec(`CREATE TABLE IF NOT EXISTS "_jsondb_documents" (
    "name" TEXT PRIMARY KEY,
    "value" TEXT NOT NULL
  ) STRICT;`);
}

export class SqliteJsonDb {
  constructor(config, resources, database) {
    this.config = config;
    this.resources = new Map(resources.map((resource) => [resource.name, resource]));
    this.database = database;
  }

  collection(name) {
    const resource = this.requireResource(name, 'collection');
    return new SqliteJsonDbCollection(this.config, resource, this.database);
  }

  document(name) {
    const resource = this.requireResource(name, 'document');
    return new SqliteJsonDbDocument(this.config, resource, this.database);
  }

  resourceNames() {
    return [...this.resources.keys()];
  }

  close() {
    this.database.close();
  }

  requireResource(name, kind) {
    const resource = this.resources.get(name);
    if (!resource) {
      throw jsonDbError(
        'SQLITE_UNKNOWN_RESOURCE',
        `Unknown SQLite jsondb resource "${name}".`,
        {
          status: 404,
          hint: `Use one of: ${listChoices(this.resourceNames())}.`,
          details: {
            resource: name,
            availableResources: this.resourceNames(),
          },
        },
      );
    }

    if (resource.kind !== kind) {
      throw jsonDbError(
        'SQLITE_RESOURCE_KIND_MISMATCH',
        `Resource "${name}" is a ${resource.kind}, not a ${kind}.`,
        {
          status: 400,
          hint: resource.kind === 'collection'
            ? `Use db.collection("${name}") for this resource.`
            : `Use db.document("${name}") for this resource.`,
          details: {
            resource: name,
            expectedKind: kind,
            actualKind: resource.kind,
          },
        },
      );
    }

    return resource;
  }
}

export class SqliteJsonDbCollection {
  constructor(config, resource, database) {
    this.config = config;
    this.resource = resource;
    this.database = database;
    this.table = quoteIdentifier(resource.name);
  }

  async all() {
    return this.database.prepare(`SELECT * FROM ${this.table}`).all().map((row) => deserializeRow(this.resource, row));
  }

  async get(id) {
    const idField = quoteIdentifier(this.resource.idField);
    const row = this.database.prepare(`SELECT * FROM ${this.table} WHERE ${idField} = ?`).get(String(id));
    return row ? deserializeRow(this.resource, row) : null;
  }

  async create(record) {
    const fields = Object.keys(this.resource.fields);
    const nextRecord = this.config.defaults?.applyOnCreate === false
      ? stripUnknownFields(this.resource, record)
      : applyDefaultsToRecord(stripUnknownFields(this.resource, record), this.resource);

    if (nextRecord[this.resource.idField] === undefined || nextRecord[this.resource.idField] === null || nextRecord[this.resource.idField] === '') {
      nextRecord[this.resource.idField] = await this.nextId();
    }

    assertRecordMatchesResource(nextRecord, this.resource, this.config, {
      source: `${this.resource.name} create body`,
    });

    const serialized = serializeRow(this.resource, nextRecord);
    const columns = fields.map(quoteIdentifier).join(', ');
    const placeholders = fields.map(() => '?').join(', ');
    try {
      this.database.prepare(`INSERT INTO ${this.table} (${columns}) VALUES (${placeholders})`).run(...fields.map((field) => serialized[field] ?? null));
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) {
        throw jsonDbError(
          'SQLITE_DUPLICATE_ID',
          `Cannot create "${this.resource.name}" record because id "${nextRecord[this.resource.idField]}" already exists.`,
          {
            status: 409,
            hint: 'Use a unique id, or call patch/update if you intended to modify the existing record.',
            details: {
              resource: this.resource.name,
              idField: this.resource.idField,
              id: nextRecord[this.resource.idField],
            },
          },
        );
      }
      throw error;
    }
    return nextRecord;
  }

  async update(id, patch) {
    return this.patch(id, patch);
  }

  async patch(id, patch) {
    const existing = await this.get(id);
    if (!existing) {
      return null;
    }

    const nextRecord = this.config.defaults?.applyOnCreate === false
      ? stripUnknownFields(this.resource, { ...existing, ...patch, [this.resource.idField]: existing[this.resource.idField] })
      : applyDefaultsToRecord(stripUnknownFields(this.resource, { ...existing, ...patch, [this.resource.idField]: existing[this.resource.idField] }), this.resource);

    assertRecordMatchesResource(nextRecord, this.resource, this.config, {
      source: `${this.resource.name} patch body`,
    });

    const fields = Object.keys(this.resource.fields).filter((field) => field !== this.resource.idField);
    const serialized = serializeRow(this.resource, nextRecord);
    const assignments = fields.map((field) => `${quoteIdentifier(field)} = ?`).join(', ');
    this.database.prepare(`UPDATE ${this.table} SET ${assignments} WHERE ${quoteIdentifier(this.resource.idField)} = ?`).run(
      ...fields.map((field) => serialized[field] ?? null),
      String(id),
    );
    return nextRecord;
  }

  async delete(id) {
    const result = this.database.prepare(`DELETE FROM ${this.table} WHERE ${quoteIdentifier(this.resource.idField)} = ?`).run(String(id));
    return result.changes > 0;
  }

  async nextId() {
    const rows = this.database.prepare(`SELECT ${quoteIdentifier(this.resource.idField)} as id FROM ${this.table}`).all();
    const ids = rows.map((row) => String(row.id)).filter(Boolean);
    const numeric = ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0);
    let next = numeric.length > 0 ? Math.max(...numeric) + 1 : ids.length + 1;

    while (ids.includes(String(next))) {
      next += 1;
    }

    return String(next);
  }
}

export class SqliteJsonDbDocument {
  constructor(config, resource, database) {
    this.config = config;
    this.resource = resource;
    this.database = database;
  }

  async all() {
    const row = this.database.prepare('SELECT value FROM "_jsondb_documents" WHERE name = ?').get(this.resource.name);
    return row ? JSON.parse(row.value) : {};
  }

  async get(pointer = '') {
    const document = await this.all();
    return pointer ? getPointer(document, pointer) : document;
  }

  async put(value) {
    const nextDocument = this.config.defaults?.applyOnCreate === false
      ? stripUnknownFields(this.resource, value)
      : applyDefaultsToRecord(stripUnknownFields(this.resource, value), this.resource);
    assertRecordMatchesResource(nextDocument, this.resource, this.config, {
      source: `${this.resource.name} document body`,
    });
    this.database.prepare('INSERT INTO "_jsondb_documents" (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value')
      .run(this.resource.name, JSON.stringify(nextDocument));
    return nextDocument;
  }

  async set(pointer, value) {
    const document = await this.all();
    setPointer(document, pointer, value);
    await this.put(document);
    return value;
  }

  async update(patch) {
    const document = await this.all();
    return this.put({ ...document, ...patch });
  }
}

function createTableSql(resource) {
  const columns = Object.entries(resource.fields).map(([fieldName, field]) => {
    const primary = fieldName === resource.idField ? ' PRIMARY KEY' : '';
    const required = field.required && fieldName !== resource.idField ? ' NOT NULL' : '';
    return `  ${quoteIdentifier(fieldName)} ${sqliteTypeForField(field)}${primary}${required}`;
  });

  return `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(resource.name)} (
${columns.join(',\n')}
) STRICT;`;
}

function sqliteTypeForField(field) {
  switch (field.type) {
    case 'number':
      return 'REAL';
    case 'boolean':
      return 'INTEGER';
    case 'string':
    case 'datetime':
    case 'enum':
    case 'object':
    case 'array':
    case 'unknown':
    default:
      return 'TEXT';
  }
}

function stripUnknownFields(resource, record) {
  const next = {};
  for (const fieldName of Object.keys(resource.fields ?? {})) {
    if (record?.[fieldName] !== undefined) {
      next[fieldName] = record[fieldName];
    }
  }
  return next;
}

function serializeRow(resource, record) {
  const row = {};
  for (const [fieldName, field] of Object.entries(resource.fields)) {
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

function deserializeRow(resource, row) {
  const record = {};
  for (const [fieldName, field] of Object.entries(resource.fields)) {
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

async function importNodeSqlite() {
  try {
    return await import('node:sqlite');
  } catch (error) {
    throw jsonDbError(
      'SQLITE_RUNTIME_UNAVAILABLE',
      'SQLite mode requires Node.js with node:sqlite support.',
      {
        status: 500,
        hint: 'Use Node.js 22.13 or newer for SQLite mode, or keep using the JSON mirror mode.',
        details: {
          parserMessage: error.message,
        },
      },
    );
  }
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function getPointer(document, pointer) {
  const parts = parsePointer(pointer);
  let value = document;
  for (const part of parts) {
    if (value === null || value === undefined) {
      return undefined;
    }
    value = value[part];
  }
  return value;
}

function setPointer(document, pointer, value) {
  const parts = parsePointer(pointer);
  let current = document;
  while (parts.length > 1) {
    const part = parts.shift();
    if (!current[part] || typeof current[part] !== 'object' || Array.isArray(current[part])) {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[0]] = value;
}

function parsePointer(pointer) {
  if (!pointer) {
    return [];
  }

  return String(pointer)
    .split('/')
    .slice(1)
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
}
