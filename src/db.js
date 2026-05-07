import path from 'node:path';
import { loadConfig } from './config.js';
import { loadProjectSchema } from './schema.js';
import { syncJsonFixtureDb, applyDefaultsToRecord } from './sync.js';
import { readJsonState, statePathForResource, writeJsonState } from './state.js';

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
      throw new Error(`Unknown jsondb resource "${name}"`);
    }

    if (resource.kind !== kind) {
      throw new Error(`Resource "${name}" is a ${resource.kind}, not a ${kind}`);
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
    const records = await this.all();
    const nextRecord = this.config.defaults?.applyOnCreate === false
      ? { ...record }
      : applyDefaultsToRecord(record, this.resource);
    const id = nextRecord[this.resource.idField];

    if (id === undefined || id === null || id === '') {
      throw new Error(`Cannot create ${this.resource.name}: missing id field "${this.resource.idField}"`);
    }

    if (records.some((existing) => existing?.[this.resource.idField] === id)) {
      throw new Error(`Cannot create ${this.resource.name}: duplicate id "${id}"`);
    }

    records.push(nextRecord);
    await writeJsonState(this.path, records);
    return nextRecord;
  }

  async update(id, patch) {
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
    await writeJsonState(this.path, records);
    return records[index];
  }

  async patch(id, patch) {
    return this.update(id, patch);
  }

  async delete(id) {
    const records = await this.all();
    const nextRecords = records.filter((record) => record?.[this.resource.idField] !== id);
    await writeJsonState(this.path, nextRecords);
    return nextRecords.length !== records.length;
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
    await writeJsonState(this.path, value);
    return value;
  }

  async set(pointer, value) {
    const document = await this.all();
    setPointer(document, pointer, value);
    await writeJsonState(this.path, document);
    return value;
  }

  async update(patch) {
    const document = await this.all();
    const nextDocument = {
      ...document,
      ...patch,
    };
    await writeJsonState(this.path, nextDocument);
    return nextDocument;
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
    throw new Error('Cannot set the root document with set(); use put() instead');
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
    throw new Error(`Invalid JSON pointer "${pointer}"`);
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
