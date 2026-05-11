import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseCsvRecords } from './csv.js';
import { jsonDbError } from './errors.js';
import { readText } from './fs-utils.js';
import { parseJsonc } from './jsonc.js';
import { routePathForResource, typeNameForResource } from './names.js';

export async function loadProjectSchema(config) {
  const files = await listSourceFiles(config.sourceDir);
  const dataFiles = new Map();
  const schemaFiles = new Map();

  for (const filename of files) {
    if (filename.endsWith('.schema.json') || filename.endsWith('.schema.jsonc') || filename.endsWith('.schema.mjs')) {
      if (config.schema?.source === 'data') {
        continue;
      }

      if (filename.endsWith('.jsonc') && config.schema?.allowJsonc === false) {
        continue;
      }

      schemaFiles.set(schemaResourceName(filename), path.join(config.sourceDir, filename));
      continue;
    }

    if (filename.endsWith('.json') || filename.endsWith('.jsonc') || filename.endsWith('.csv')) {
      if (config.schema?.source === 'schema') {
        continue;
      }

      if (filename.endsWith('.jsonc') && config.schema?.allowJsonc === false) {
        continue;
      }

      dataFiles.set(dataResourceName(filename), path.join(config.sourceDir, filename));
    }
  }

  const resourceNames = [...new Set([...dataFiles.keys(), ...schemaFiles.keys()])].sort();
  const resources = [];
  const diagnostics = [];

  for (const name of resourceNames) {
    const dataPath = dataFiles.get(name);
    const schemaPath = schemaFiles.get(name);
    let rawDataSource;
    let rawSchema;

    if (dataPath) {
      try {
        rawDataSource = await loadDataFile(dataPath);
      } catch (error) {
        diagnostics.push(sourceLoadDiagnostic(error, dataPath, name, config));
      }
    }

    const rawData = rawDataSource?.data;

    if (schemaPath) {
      try {
        rawSchema = await loadSchemaFile(schemaPath);
      } catch (error) {
        diagnostics.push(sourceLoadDiagnostic(error, schemaPath, name, config));
      }
    }

    if (rawData === undefined && rawSchema === undefined) {
      continue;
    }

    const resource = buildResource({
      name,
      dataPath: rawDataSource ? dataPath : undefined,
      dataFormat: rawDataSource?.format,
      dataHash: rawDataSource?.hash,
      schemaPath: rawSchema ? schemaPath : undefined,
      rawData,
      rawSchema,
      config,
    });

    diagnostics.push(...validateResourceSeed(resource, config));
    resources.push(resource);
  }

  return {
    resources,
    diagnostics,
    schema: makeGeneratedSchema(resources, diagnostics),
  };
}

export function makeGeneratedSchema(resources, diagnostics = []) {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    resources: Object.fromEntries(resources.map((resource) => [resource.name, serializeResource(resource)])),
    rest: Object.fromEntries(resources.map((resource) => [resource.name, restRoutes(resource)])),
    graphql: generateGraphqlSdl(resources),
    diagnostics,
  };
}

export function normalizeField(field, fieldName = '') {
  if (!field || typeof field !== 'object' || Array.isArray(field)) {
    return inferFieldFromValue(field, fieldName, { required: false });
  }

  const normalized = {
    type: field.type ?? 'unknown',
  };

  if ('nullable' in field) {
    normalized.nullable = Boolean(field.nullable);
  }

  if ('required' in field) {
    normalized.required = Boolean(field.required);
  }

  if ('description' in field) {
    normalized.description = String(field.description);
  }

  if ('default' in field) {
    normalized.default = field.default;
  }

  if (field.type === 'enum') {
    normalized.values = Array.isArray(field.values) ? [...field.values] : [];
  }

  if (field.type === 'array') {
    normalized.items = normalizeField(field.items ?? { type: 'unknown' }, `${fieldName}Item`);
  }

  if (field.type === 'object' && 'additionalProperties' in field) {
    normalized.additionalProperties = Boolean(field.additionalProperties);
  }

  if (field.type === 'object' && field.fields && typeof field.fields === 'object') {
    normalized.fields = Object.fromEntries(
      Object.entries(field.fields).map(([childName, childField]) => [childName, normalizeField(childField, childName)]),
    );
  }

  return normalized;
}

export function inferFieldsFromData(value, kind = 'collection') {
  if (kind === 'collection') {
    const records = Array.isArray(value) ? value : [];
    const names = new Set();
    for (const record of records) {
      if (record && typeof record === 'object' && !Array.isArray(record)) {
        for (const key of Object.keys(record)) {
          names.add(key);
        }
      }
    }

    return Object.fromEntries(
      [...names].sort().map((fieldName) => {
        const samples = records.map((record) => record?.[fieldName]);
        const present = samples.filter((sample) => sample !== undefined && sample !== null);
        const required = records.length > 0 && present.length === records.length;
        return [fieldName, inferFieldFromSamples(present, fieldName, { required })];
      }),
    );
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([fieldName, sample]) => [fieldName, inferFieldFromValue(sample, fieldName, { required: false })]),
  );
}

export function inferFieldFromSamples(samples, fieldName, options = {}) {
  if (samples.length === 0) {
    return { type: 'unknown', required: Boolean(options.required) };
  }

  const inferred = samples.map((sample) => inferFieldFromValue(sample, fieldName, options));
  return mergeInferredFields(inferred, options.required);
}

export function inferFieldFromValue(value, fieldName, options = {}) {
  const required = Boolean(options.required);

  if (value === null || value === undefined) {
    return { type: 'unknown', required: false };
  }

  if (Array.isArray(value)) {
    return {
      type: 'array',
      required,
      items: inferFieldFromSamples(value.filter((item) => item !== null && item !== undefined), `${fieldName}Item`, {
        required: false,
      }),
    };
  }

  if (typeof value === 'object') {
    return {
      type: 'object',
      required,
      fields: inferFieldsFromData(value, 'document'),
    };
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return { type: typeof value, required };
  }

  return { type: 'unknown', required };
}

export function assertRecordMatchesResource(record, resource, config, options = {}) {
  const diagnostics = validateRecordAgainstResource(record, resource, config, options)
    .filter((diagnostic) => diagnostic.severity === 'error');

  if (diagnostics.length === 0) {
    return;
  }

  throw jsonDbError(
    'DB_SCHEMA_VALIDATION_FAILED',
    `${resource.name} record does not match its schema: ${diagnostics[0].message}`,
    {
      status: 400,
      hint: 'Update the record to match the schema field types, required fields, and enum values.',
      details: {
        resource: resource.name,
        diagnostics,
      },
    },
  );
}

export function validateRecordAgainstResource(record, resource, config, options = {}) {
  const diagnostics = [];
  const source = options.source ?? `${resource.name} record`;

  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    diagnostics.push({
      code: 'SCHEMA_RECORD_INVALID',
      severity: 'error',
      resource: resource.name,
      message: `${source} must be an object`,
    });
    return diagnostics;
  }

  const fields = resource.fields ?? {};
  const unknownFields = Object.keys(record).filter((fieldName) => !(fieldName in fields));
  for (const fieldName of unknownFields) {
    const setting = config.schema?.unknownFields ?? 'warn';
    if (setting === 'allow') {
      continue;
    }

    diagnostics.push({
      code: 'SCHEMA_UNKNOWN_FIELD',
      severity: setting === 'error' ? 'error' : 'warn',
      resource: resource.name,
      field: fieldName,
      message: `${path.basename(resource.dataPath ?? `${resource.name}.json`)} has field "${fieldName}" but ${path.basename(resource.schemaPath ?? `${resource.name}.schema`)} does not define "${fieldName}"`,
    });
  }

  for (const [fieldName, field] of Object.entries(fields)) {
    if (field.required && (record[fieldName] === undefined || (record[fieldName] === null && !field.nullable))) {
      diagnostics.push({
        code: 'SCHEMA_REQUIRED_FIELD_MISSING',
        severity: 'error',
        resource: resource.name,
        field: fieldName,
        message: `${resource.name} record is missing required field "${fieldName}"`,
      });
      continue;
    }

    if (record[fieldName] !== undefined) {
      diagnostics.push(...validateValueAgainstField(record[fieldName], field, {
        config,
        fieldPath: fieldName,
        resource,
      }));
    }
  }

  return diagnostics;
}

export function validateValueAgainstField(value, field, context) {
  const diagnostics = [];
  const expected = describeExpectedField(field);

  if (value === undefined) {
    return diagnostics;
  }

  if (value === null) {
    return field.nullable || field.type === 'unknown'
      ? diagnostics
      : [
        typeMismatch(context, expected, value),
      ];
  }

  switch (field.type) {
    case 'unknown':
      return diagnostics;
    case 'string':
      return typeof value === 'string' ? diagnostics : [typeMismatch(context, expected, value)];
    case 'datetime':
      return typeof value === 'string' ? diagnostics : [typeMismatch(context, expected, value)];
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? diagnostics : [typeMismatch(context, expected, value)];
    case 'boolean':
      return typeof value === 'boolean' ? diagnostics : [typeMismatch(context, expected, value)];
    case 'enum':
      return (field.values ?? []).includes(value)
        ? diagnostics
        : [
          {
            code: 'SCHEMA_ENUM_VALUE_INVALID',
            severity: 'error',
            resource: context.resource.name,
            field: context.fieldPath,
            message: `${context.resource.name} field "${context.fieldPath}" expected ${expected} but received ${JSON.stringify(value)}`,
            details: {
              expected,
              received: value,
              values: field.values ?? [],
            },
          },
        ];
    case 'array':
      if (!Array.isArray(value)) {
        return [typeMismatch(context, expected, value)];
      }
      for (const [index, item] of value.entries()) {
        diagnostics.push(...validateValueAgainstField(item, field.items ?? { type: 'unknown' }, {
          ...context,
          fieldPath: `${context.fieldPath}[${index}]`,
        }));
      }
      return diagnostics;
    case 'object':
      if (!isPlainRecord(value)) {
        return [typeMismatch(context, expected, value)];
      }
      return validateObjectFields(value, field, context);
    default:
      return diagnostics;
  }
}

function validateObjectFields(value, field, context) {
  const diagnostics = [];
  const fields = field.fields ?? {};

  if (field.additionalProperties !== true) {
    for (const childName of Object.keys(value)) {
      if (childName in fields) {
        continue;
      }

      const setting = context.config.schema?.unknownFields ?? 'warn';
      if (setting === 'allow') {
        continue;
      }

      const fieldPath = `${context.fieldPath}.${childName}`;
      diagnostics.push({
        code: 'SCHEMA_UNKNOWN_FIELD',
        severity: setting === 'error' ? 'error' : 'warn',
        resource: context.resource.name,
        field: fieldPath,
        message: `${context.resource.name} field "${fieldPath}" is not defined in the schema`,
      });
    }
  }

  for (const [childName, childField] of Object.entries(fields)) {
    const fieldPath = `${context.fieldPath}.${childName}`;
    const childValue = value[childName];

    if (childField.required && (childValue === undefined || (childValue === null && !childField.nullable))) {
      diagnostics.push({
        code: 'SCHEMA_REQUIRED_FIELD_MISSING',
        severity: 'error',
        resource: context.resource.name,
        field: fieldPath,
        message: `${context.resource.name} record is missing required field "${fieldPath}"`,
      });
      continue;
    }

    diagnostics.push(...validateValueAgainstField(childValue, childField, {
      ...context,
      fieldPath,
    }));
  }

  return diagnostics;
}

function typeMismatch(context, expected, value) {
  return {
    code: 'SCHEMA_FIELD_TYPE_MISMATCH',
    severity: 'error',
    resource: context.resource.name,
    field: context.fieldPath,
    message: `${context.resource.name} field "${context.fieldPath}" expected ${expected} but received ${describeJsonValue(value)}`,
    details: {
      expected,
      receivedType: describeJsonValue(value),
    },
  };
}

function describeExpectedField(field) {
  switch (field.type) {
    case 'enum':
      return `one of ${field.values?.map((value) => JSON.stringify(value)).join(', ') || '[]'}`;
    case 'array':
      return `array of ${describeExpectedField(field.items ?? { type: 'unknown' })}`;
    case 'object':
      return 'object';
    case 'unknown':
      return 'any JSON value';
    default:
      return field.type ?? 'unknown';
  }
}

function describeJsonValue(value) {
  if (value === null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return 'array';
  }

  return typeof value;
}

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function buildResource({ name, dataPath, dataFormat, dataHash, schemaPath, rawData, rawSchema, config }) {
  if (rawSchema) {
    const kind = rawSchema.kind ?? inferKindFromData(rawData) ?? 'collection';
    const idField = rawSchema.idField ?? config.collections?.[name]?.idField ?? 'id';
    const schemaSeed = rawSchema.seed ?? emptySeedForKind(kind);
    const seed = rawData !== undefined ? rawData : schemaSeed;
    let fields = Object.fromEntries(
      Object.entries(rawSchema.fields ?? {}).map(([fieldName, field]) => [fieldName, normalizeField(field, fieldName)]),
    );
    if (kind === 'collection') {
      fields = ensureCollectionIdField(fields, idField);
    }
    const normalizedSeed = normalizeSeed(dataFormat === 'csv' ? coerceCsvSeedToSchema(seed, fields, kind) : seed, kind);
    const idResult = ensureCollectionSeedIds(normalizedSeed, kind, idField);

    return withComputedMetadata({
      name,
      kind,
      idField,
      description: rawSchema.description,
      fields,
      seed: idResult.seed,
      dataPath,
      dataFormat,
      dataHash,
      schemaPath,
      schemaSource: schemaSourceFromPath(schemaPath),
      typeSource: 'schema',
      generatedIds: idResult.generated,
    });
  }

  const kind = inferKindFromData(rawData);
  const idField = config.collections?.[name]?.idField ?? inferIdField(rawData, kind);
  const normalizedSeed = normalizeSeed(rawData, kind);
  const idResult = ensureCollectionSeedIds(normalizedSeed, kind, idField);
  const fields = kind === 'collection'
    ? ensureCollectionIdField(inferFieldsFromData(idResult.seed, kind), idField)
    : inferFieldsFromData(idResult.seed, kind);

  return withComputedMetadata({
    name,
    kind,
    idField,
    fields,
    seed: idResult.seed,
    dataPath,
    dataFormat,
    dataHash,
    schemaPath,
    schemaSource: null,
    typeSource: 'data',
    generatedIds: idResult.generated,
  });
}

function coerceCsvSeedToSchema(seed, fields, kind) {
  if (kind === 'collection') {
    return Array.isArray(seed)
      ? seed.map((record) => coerceCsvRecordToSchema(record, fields))
      : seed;
  }

  return coerceCsvRecordToSchema(seed, fields);
}

function coerceCsvRecordToSchema(record, fields) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return record;
  }

  const next = { ...record };
  for (const [fieldName, field] of Object.entries(fields ?? {})) {
    if (field.type === 'array' && typeof next[fieldName] === 'string') {
      next[fieldName] = parseCsvArrayValue(next[fieldName], field.items ?? { type: 'unknown' });
    }
  }
  return next;
}

function parseCsvArrayValue(value, itemField) {
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => coerceCsvArrayItem(item, itemField));
      }
    } catch {
      return value;
    }
  }

  return trimmed
    .split(';')
    .map((item) => item.trim())
    .filter((item) => item !== '')
    .map((item) => coerceCsvArrayItem(item, itemField));
}

function coerceCsvArrayItem(value, itemField) {
  if (typeof value !== 'string') {
    return value;
  }

  if (itemField.type === 'number' && /^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    return Number(value);
  }

  if (itemField.type === 'boolean') {
    const lower = value.toLowerCase();
    if (lower === 'true') {
      return true;
    }
    if (lower === 'false') {
      return false;
    }
  }

  return value;
}

function withComputedMetadata(resource) {
  return {
    ...resource,
    typeName: typeNameForResource(resource.name, resource.kind),
    routePath: routePathForResource(resource.name),
  };
}

async function listSourceFiles(sourceDir) {
  try {
    const entries = await readdir(sourceDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function loadDataFile(filePath) {
  const text = await readText(filePath);
  const hash = createHash('sha256').update(text).digest('hex');
  if (filePath.endsWith('.csv')) {
    return {
      data: parseCsvRecords(text, filePath),
      format: 'csv',
      hash,
    };
  }

  if (filePath.endsWith('.jsonc')) {
    return {
      data: parseJsonc(text, filePath),
      format: 'jsonc',
      hash,
    };
  }

  return {
    data: JSON.parse(text),
    format: 'json',
    hash,
  };
}

async function loadSchemaFile(filePath) {
  if (filePath.endsWith('.mjs')) {
    const url = pathToFileURL(filePath);
    url.searchParams.set('jsondbSchemaLoad', String(Date.now()));
    const module = await import(url.href);
    return module.default;
  }

  if (filePath.endsWith('.schema.json')) {
    return JSON.parse(await readText(filePath));
  }

  return parseJsonc(await readText(filePath), filePath);
}

function schemaSourceFromPath(schemaPath) {
  if (!schemaPath) {
    return null;
  }

  if (schemaPath.endsWith('.mjs')) {
    return 'mjs';
  }

  if (schemaPath.endsWith('.schema.json')) {
    return 'json';
  }

  return 'jsonc';
}

function dataResourceName(filename) {
  return filename.replace(/\.(jsonc?|csv)$/, '');
}

function schemaResourceName(filename) {
  return filename.replace(/\.schema\.(json|jsonc|mjs)$/, '');
}

function inferKindFromData(data) {
  return Array.isArray(data) ? 'collection' : 'document';
}

function inferIdField(data, kind) {
  if (kind !== 'collection' || !Array.isArray(data) || data.length === 0) {
    return 'id';
  }

  if (data.every((record) => record && typeof record === 'object' && 'id' in record)) {
    return 'id';
  }

  const firstRecord = data.find((record) => record && typeof record === 'object' && !Array.isArray(record));
  return Object.keys(firstRecord ?? {}).find((fieldName) => /id$/i.test(fieldName)) ?? 'id';
}

function ensureCollectionIdField(fields, idField) {
  if (idField in fields) {
    return fields;
  }

  return {
    [idField]: {
      type: 'string',
      required: true,
      description: 'Generated local id.',
    },
    ...fields,
  };
}

function ensureCollectionSeedIds(seed, kind, idField) {
  if (kind !== 'collection' || !Array.isArray(seed)) {
    return {
      seed,
      generated: false,
    };
  }

  const usedIds = new Set(seed
    .map((record) => record?.[idField])
    .filter((id) => id !== undefined && id !== null && id !== '')
    .map((id) => String(id)));
  let nextId = nextCounterId(usedIds);
  let generated = false;

  const records = seed.map((record) => {
    if (!isPlainRecord(record) || (record[idField] !== undefined && record[idField] !== null && record[idField] !== '')) {
      return record;
    }

    generated = true;
    while (usedIds.has(String(nextId))) {
      nextId += 1;
    }
    const id = String(nextId);
    usedIds.add(id);
    nextId += 1;
    return {
      [idField]: id,
      ...record,
    };
  });

  return {
    seed: records,
    generated,
  };
}

function nextCounterId(usedIds) {
  const numericIds = [...usedIds]
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);

  if (numericIds.length > 0) {
    return Math.max(...numericIds) + 1;
  }

  return 1;
}

function normalizeSeed(seed, kind) {
  if (kind === 'collection') {
    return Array.isArray(seed) ? seed : [];
  }

  if (seed && typeof seed === 'object' && !Array.isArray(seed)) {
    return seed;
  }

  return {};
}

function emptySeedForKind(kind) {
  return kind === 'collection' ? [] : {};
}

function validateResourceSeed(resource, config) {
  if (resource.kind === 'collection') {
    return resource.seed.flatMap((record, index) => validateRecordAgainstResource(record, resource, config, {
      source: `${resource.name} seed record ${index}`,
    }));
  }

  return validateRecordAgainstResource(resource.seed, resource, config, {
    source: `${resource.name} seed document`,
  });
}

function mergeInferredFields(fields, required) {
  if (fields.length === 0) {
    return { type: 'unknown', required: Boolean(required) };
  }

  const types = new Set(fields.map((field) => field.type));
  if (types.size > 1) {
    return { type: 'unknown', required: Boolean(required) };
  }

  const [first] = fields;
  if (first.type === 'object') {
    const names = new Set();
    for (const field of fields) {
      for (const childName of Object.keys(field.fields ?? {})) {
        names.add(childName);
      }
    }

    return {
      type: 'object',
      required: Boolean(required),
      fields: Object.fromEntries(
        [...names].sort().map((childName) => {
          const childSamples = fields.map((field) => field.fields?.[childName]).filter(Boolean);
          return [childName, mergeInferredFields(childSamples, childSamples.every((field) => field.required))];
        }),
      ),
    };
  }

  if (first.type === 'array') {
    return {
      type: 'array',
      required: Boolean(required),
      items: mergeInferredFields(fields.map((field) => field.items).filter(Boolean), false),
    };
  }

  return {
    ...first,
    required: Boolean(required),
  };
}

function serializeResource(resource) {
  return {
    kind: resource.kind,
    typeName: resource.typeName,
    routePath: resource.routePath,
    idField: resource.kind === 'collection' ? resource.idField : undefined,
    description: resource.description,
    fields: resource.fields,
    seed: resource.seed,
    source: {
      typeSource: resource.typeSource,
      dataPath: resource.dataPath,
      dataFormat: resource.dataFormat,
      dataHash: resource.dataHash,
      schemaPath: resource.schemaPath,
      generatedIds: resource.generatedIds,
    },
  };
}

function sourceLoadDiagnostic(error, filePath, resource, config) {
  const relativePath = path.relative(config.cwd, filePath);
  return {
    code: 'SOURCE_LOAD_FAILED',
    severity: 'error',
    resource,
    file: relativePath,
    message: `Could not load ${relativePath}: ${error.message}`,
    hint: error.hint ?? 'Fix this source file and jsondb will reload the rest of the project.',
    details: {
      path: relativePath,
      parserMessage: error.message,
      code: error.code,
    },
  };
}

function restRoutes(resource) {
  if (resource.kind === 'document') {
    return [
      `GET ${resource.routePath}`,
      `PUT ${resource.routePath}`,
      `PATCH ${resource.routePath}`,
    ];
  }

  return [
    `GET ${resource.routePath}`,
    `GET ${resource.routePath}/:${resource.idField}`,
    `POST ${resource.routePath}`,
    `PATCH ${resource.routePath}/:${resource.idField}`,
    `DELETE ${resource.routePath}/:${resource.idField}`,
  ];
}

function generateGraphqlSdl(resources) {
  const lines = ['scalar JSON', ''];

  for (const resource of resources) {
    lines.push(...graphqlType(resource), '');
  }

  return lines.join('\n').trimEnd();
}

function graphqlType(resource) {
  const lines = [`type ${resource.typeName} {`];
  for (const [fieldName, field] of Object.entries(resource.fields)) {
    if (field.description) {
      lines.push(`  "${field.description.replaceAll('"', '\\"')}"`);
    }
    lines.push(`  ${fieldName}: ${graphqlFieldType(field, fieldName === resource.idField)}`);
  }
  lines.push('}');
  return lines;
}

function graphqlFieldType(field, isIdField = false) {
  if (isIdField) {
    return field.required ? 'ID!' : 'ID';
  }

  const suffix = field.required ? '!' : '';
  switch (field.type) {
    case 'string':
    case 'datetime':
    case 'enum':
      return `String${suffix}`;
    case 'number':
      return `Float${suffix}`;
    case 'boolean':
      return `Boolean${suffix}`;
    case 'array':
      return `[JSON]${suffix}`;
    case 'object':
    case 'unknown':
    default:
      return `JSON${suffix}`;
  }
}
