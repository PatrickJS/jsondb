import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readText } from './fs-utils.js';
import { parseJsonc } from './jsonc.js';
import { routePathForResource, typeNameForResource } from './names.js';

export async function loadProjectSchema(config) {
  const files = await listSourceFiles(config.sourceDir);
  const dataFiles = new Map();
  const schemaFiles = new Map();

  for (const filename of files) {
    if (filename.endsWith('.schema.jsonc') || filename.endsWith('.schema.mjs')) {
      if (config.schema?.source === 'data') {
        continue;
      }

      if (filename.endsWith('.jsonc') && config.schema?.allowJsonc === false) {
        continue;
      }

      schemaFiles.set(schemaResourceName(filename), path.join(config.sourceDir, filename));
      continue;
    }

    if (filename.endsWith('.json') || filename.endsWith('.jsonc')) {
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
    const rawData = dataPath ? await loadDataFile(dataPath) : undefined;
    const rawSchema = schemaPath ? await loadSchemaFile(schemaPath) : undefined;
    const resource = buildResource({
      name,
      dataPath,
      schemaPath,
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

export function validateRecordAgainstResource(record, resource, config) {
  const diagnostics = [];

  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    diagnostics.push({
      severity: 'error',
      resource: resource.name,
      message: `${resource.name} seed contains a non-object record`,
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
      severity: setting === 'error' ? 'error' : 'warn',
      resource: resource.name,
      field: fieldName,
      message: `${path.basename(resource.dataPath ?? `${resource.name}.json`)} has field "${fieldName}" but ${path.basename(resource.schemaPath ?? `${resource.name}.schema`)} does not define "${fieldName}"`,
    });
  }

  for (const [fieldName, field] of Object.entries(fields)) {
    if (field.required && (record[fieldName] === undefined || record[fieldName] === null)) {
      diagnostics.push({
        severity: 'error',
        resource: resource.name,
        field: fieldName,
        message: `${resource.name} record is missing required field "${fieldName}"`,
      });
    }
  }

  return diagnostics;
}

function buildResource({ name, dataPath, schemaPath, rawData, rawSchema, config }) {
  if (rawSchema) {
    const kind = rawSchema.kind ?? inferKindFromData(rawData) ?? 'collection';
    const schemaSeed = rawSchema.seed ?? emptySeedForKind(kind);
    const seed = rawData !== undefined ? rawData : schemaSeed;
    const fields = Object.fromEntries(
      Object.entries(rawSchema.fields ?? {}).map(([fieldName, field]) => [fieldName, normalizeField(field, fieldName)]),
    );

    return withComputedMetadata({
      name,
      kind,
      idField: rawSchema.idField ?? config.collections?.[name]?.idField ?? 'id',
      description: rawSchema.description,
      fields,
      seed: normalizeSeed(seed, kind),
      dataPath,
      schemaPath,
      schemaSource: schemaPath?.endsWith('.mjs') ? 'mjs' : 'jsonc',
      typeSource: 'schema',
    });
  }

  const kind = inferKindFromData(rawData);
  return withComputedMetadata({
    name,
    kind,
    idField: config.collections?.[name]?.idField ?? inferIdField(rawData, kind),
    fields: inferFieldsFromData(rawData, kind),
    seed: normalizeSeed(rawData, kind),
    dataPath,
    schemaPath,
    schemaSource: null,
    typeSource: 'data',
  });
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
  if (filePath.endsWith('.jsonc')) {
    return parseJsonc(text, filePath);
  }
  return JSON.parse(text);
}

async function loadSchemaFile(filePath) {
  if (filePath.endsWith('.mjs')) {
    const url = pathToFileURL(filePath);
    url.searchParams.set('jsondbSchemaLoad', String(Date.now()));
    const module = await import(url.href);
    return module.default;
  }

  return parseJsonc(await readText(filePath), filePath);
}

function dataResourceName(filename) {
  return filename.replace(/\.jsonc?$/, '');
}

function schemaResourceName(filename) {
  return filename.replace(/\.schema\.(jsonc|mjs)$/, '');
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
  if (!resource.schemaPath) {
    return [];
  }

  if (resource.kind === 'collection') {
    return resource.seed.flatMap((record) => validateRecordAgainstResource(record, resource, config));
  }

  return validateRecordAgainstResource(resource.seed, resource, config);
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
    idField: resource.kind === 'collection' ? resource.idField : undefined,
    description: resource.description,
    fields: resource.fields,
    seed: resource.seed,
    source: {
      typeSource: resource.typeSource,
      dataPath: resource.dataPath,
      schemaPath: resource.schemaPath,
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
