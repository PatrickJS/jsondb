import path from 'node:path';
import { loadConfig } from './config.js';
import { jsonDbError, listChoices } from './errors.js';
import { assertRecordMatchesResource } from './schema.js';
import { loadProjectSchema } from './schema.js';
import { syncJsonFixtureDb, applyDefaultsToRecord } from './sync.js';
import { readJsonState, statePathForResource, withJsonStateWrite, writeJsonState } from './state.js';

export async function openJsonFixtureDb(options = {}) {
  const config = await loadConfig(options);
  const syncOnOpen = options.syncOnOpen ?? true;
  const project = syncOnOpen
    ? await syncJsonFixtureDb(config)
    : await loadProjectSchema(config);

  return new JsonFixtureDb(config, project.resources);
}

export class JsonFixtureDb {
  constructor(config, resources) {
    this.config = config;
    this.resources = new Map(resources.map((resource) => [resource.name, resource]));
  }

  collection(name) {
    const resource = this.requireResource(name, 'collection');
    return new JsonDbCollection(this.config, resource);
  }

  document(name) {
    const resource = this.requireResource(name, 'document');
    return new JsonDbDocument(this.config, resource);
  }

  requireResource(name, kind) {
    const resource = this.resources.get(name);
    if (!resource) {
      throw jsonDbError(
        'DB_UNKNOWN_RESOURCE',
        `Unknown jsondb resource "${name}".`,
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
        'DB_RESOURCE_KIND_MISMATCH',
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

  resourceNames() {
    return [...this.resources.keys()];
  }
}

export class JsonDbCollection {
  constructor(config, resource) {
    this.config = config;
    this.resource = resource;
    this.path = statePathForResource(config, resource.name);
  }

  async all() {
    return readJsonState(this.path, []);
  }

  async get(id) {
    const records = await this.all();
    return records.find((record) => record?.[this.resource.idField] === id) ?? null;
  }

  async create(record) {
    return withJsonStateWrite(this.path, async () => {
      const records = await this.all();
      const nextRecord = this.config.defaults?.applyOnCreate === false
        ? { ...record }
        : applyDefaultsToRecord(record, this.resource);
      const id = nextRecord[this.resource.idField];

      if (id === undefined || id === null || id === '') {
        throw jsonDbError(
          'DB_CREATE_MISSING_ID',
          `Cannot create "${this.resource.name}" record because id field "${this.resource.idField}" is missing.`,
          {
            status: 400,
            hint: `Include "${this.resource.idField}" in the record body, or configure collections.${this.resource.name}.idField if this collection uses a different id field.`,
            details: {
              resource: this.resource.name,
              idField: this.resource.idField,
            },
          },
        );
      }

      assertRecordMatchesResource(nextRecord, this.resource, this.config, {
        source: `${this.resource.name} create body`,
      });

      if (records.some((existing) => existing?.[this.resource.idField] === id)) {
        throw jsonDbError(
          'DB_CREATE_DUPLICATE_ID',
          `Cannot create "${this.resource.name}" record because id "${id}" already exists.`,
          {
            status: 409,
            hint: 'Use a unique id, or call patch/update if you intended to modify the existing record.',
            details: {
              resource: this.resource.name,
              idField: this.resource.idField,
              id,
            },
          },
        );
      }

      records.push(nextRecord);
      await writeJsonState(this.path, records);
      return nextRecord;
    });
  }

  async update(id, patch) {
    return withJsonStateWrite(this.path, async () => {
      const records = await this.all();
      const index = records.findIndex((record) => record?.[this.resource.idField] === id);
      if (index === -1) {
        return null;
      }

      const nextRecord = {
        ...records[index],
        ...patch,
        [this.resource.idField]: id,
      };
      records[index] = this.config.defaults?.applyOnCreate === false
        ? nextRecord
        : applyDefaultsToRecord(nextRecord, this.resource);
      assertRecordMatchesResource(records[index], this.resource, this.config, {
        source: `${this.resource.name} patch body`,
      });
      await writeJsonState(this.path, records);
      return records[index];
    });
  }

  async patch(id, patch) {
    return this.update(id, patch);
  }

  async delete(id) {
    return withJsonStateWrite(this.path, async () => {
      const records = await this.all();
      const nextRecords = records.filter((record) => record?.[this.resource.idField] !== id);
      await writeJsonState(this.path, nextRecords);
      return nextRecords.length !== records.length;
    });
  }
}

export class JsonDbDocument {
  constructor(config, resource) {
    this.config = config;
    this.resource = resource;
    this.path = statePathForResource(config, resource.name);
  }

  async all() {
    return readJsonState(this.path, {});
  }

  async get(pointer = '') {
    const document = await this.all();
    return pointer ? getPointer(document, pointer) : document;
  }

  async put(value) {
    return withJsonStateWrite(this.path, async () => {
      assertRecordMatchesResource(value, this.resource, this.config, {
        source: `${this.resource.name} document body`,
      });
      await writeJsonState(this.path, value);
      return value;
    });
  }

  async set(pointer, value) {
    return withJsonStateWrite(this.path, async () => {
      const document = await this.all();
      setPointer(document, pointer, value);
      assertRecordMatchesResource(document, this.resource, this.config, {
        source: `${this.resource.name} document body`,
      });
      await writeJsonState(this.path, document);
      return value;
    });
  }

  async update(patch) {
    return withJsonStateWrite(this.path, async () => {
      const document = await this.all();
      const nextDocument = {
        ...document,
        ...patch,
      };
      assertRecordMatchesResource(nextDocument, this.resource, this.config, {
        source: `${this.resource.name} document patch body`,
      });
      await writeJsonState(this.path, nextDocument);
      return nextDocument;
    });
  }
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
  if (parts.length === 0) {
    throw jsonDbError(
      'DB_DOCUMENT_SET_ROOT',
      'Cannot set the root document with set().',
      {
        status: 400,
        hint: 'Use document.put(value) to replace the whole document, or pass a JSON pointer like "/theme" to set a nested value.',
      },
    );
  }

  let current = document;
  for (const part of parts.slice(0, -1)) {
    if (!current[part] || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts.at(-1)] = value;
}

function parsePointer(pointer) {
  if (!pointer || pointer === '/') {
    return [];
  }

  if (!pointer.startsWith('/')) {
    throw jsonDbError(
      'DB_INVALID_JSON_POINTER',
      `Invalid JSON pointer "${pointer}".`,
      {
        status: 400,
        hint: 'JSON pointers must start with "/". For example: "/theme" or "/features/billing".',
        details: { pointer },
      },
    );
  }

  return pointer
    .slice(1)
    .split('/')
    .filter(Boolean)
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
}

export function stateFileForDebug(db, resourceName) {
  return path.join(db.config.stateDir, 'state', `${resourceName}.json`);
}
