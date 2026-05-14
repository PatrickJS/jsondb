import { jsonDbError } from '../../errors.js';
import { assertRecordMatchesResource, validateUniqueCollectionFields } from '../../schema.js';
import { applyDefaultsToRecord } from '../../sync.js';
import { readJsonState, statePathForResource, withJsonStateWrite, writeJsonState } from './state.js';

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
    return records.find((record) => idMatches(record?.[this.resource.idField], id)) ?? null;
  }

  async create(record) {
    return withJsonStateWrite(this.path, async () => {
      const records = await this.all();
      const nextRecord = this.config.defaults?.applyOnCreate === false
        ? { ...record }
        : applyDefaultsToRecord(record, this.resource);
      let id = nextRecord[this.resource.idField];

      if (id === undefined || id === null || id === '') {
        id = nextCollectionId(records, this.resource.idField);
        nextRecord[this.resource.idField] = id;
      }

      assertRecordMatchesResource(nextRecord, this.resource, this.config, {
        source: `${this.resource.name} create body`,
      });

      if (records.some((existing) => idMatches(existing?.[this.resource.idField], id))) {
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

      assertUniqueCollectionRecords([...records, nextRecord], this.resource);
      records.push(nextRecord);
      await writeJsonState(this.path, records);
      return nextRecord;
    });
  }

  async update(id, patch) {
    return withJsonStateWrite(this.path, async () => {
      const records = await this.all();
      const index = records.findIndex((record) => idMatches(record?.[this.resource.idField], id));
      if (index === -1) {
        return null;
      }
      const existingId = records[index]?.[this.resource.idField];

      const nextRecord = {
        ...records[index],
        ...patch,
        [this.resource.idField]: existingId,
      };
      const nextRecords = [...records];
      nextRecords[index] = this.config.defaults?.applyOnCreate === false
        ? nextRecord
        : applyDefaultsToRecord(nextRecord, this.resource);
      assertRecordMatchesResource(nextRecords[index], this.resource, this.config, {
        source: `${this.resource.name} patch body`,
      });
      assertUniqueCollectionRecords(nextRecords, this.resource);
      await writeJsonState(this.path, nextRecords);
      return nextRecords[index];
    });
  }

  async patch(id, patch) {
    return this.update(id, patch);
  }

  async delete(id) {
    return withJsonStateWrite(this.path, async () => {
      const records = await this.all();
      const nextRecords = records.filter((record) => !idMatches(record?.[this.resource.idField], id));
      await writeJsonState(this.path, nextRecords);
      return nextRecords.length !== records.length;
    });
  }
}

function assertUniqueCollectionRecords(records, resource) {
  const diagnostics = validateUniqueCollectionFields(resource, records).filter((diagnostic) => diagnostic.severity === 'error');
  if (diagnostics.length === 0) {
    return;
  }

  throw jsonDbError(
    'DB_SCHEMA_VALIDATION_FAILED',
    `${resource.name} record does not match its schema: ${diagnostics[0].message}`,
    {
      status: 400,
      hint: 'Update the record to satisfy unique schema fields.',
      details: {
        resource: resource.name,
        diagnostics,
      },
    },
  );
}

function idMatches(left, right) {
  return left !== undefined && left !== null && right !== undefined && right !== null && String(left) === String(right);
}

function nextCollectionId(records, idField) {
  const usedIds = new Set(records
    .map((record) => record?.[idField])
    .filter((id) => id !== undefined && id !== null && id !== '')
    .map((id) => String(id)));
  const numericIds = [...usedIds]
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);
  let next = numericIds.length > 0 ? Math.max(...numericIds) + 1 : records.length + 1;

  while (usedIds.has(String(next))) {
    next += 1;
  }

  return String(next);
}
