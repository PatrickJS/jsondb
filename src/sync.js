import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { loadProjectSchema, makeGeneratedSchema } from './schema.js';
import { generateTypes } from './types.js';
import { readJsonState, statePathForResource, writeJsonState } from './state.js';
import { writeText } from './fs-utils.js';

export async function syncJsonFixtureDb(config, options = {}) {
  const project = await loadProjectSchema(config);
  const logs = [];
  const errors = project.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');

  for (const resource of project.resources) {
    logs.push(`Loaded ${path.relative(config.cwd, resource.schemaPath ?? resource.dataPath)}`);
  }

  if (errors.length > 0 && options.allowErrors !== true) {
    const error = new Error(errors.map((diagnostic) => diagnostic.message).join('\n'));
    error.diagnostics = project.diagnostics;
    throw error;
  }

  await writeGeneratedIdsToSources(config, project.resources, logs);
  project.schema = makeGeneratedSchema(project.resources, project.diagnostics);

  await ensureRuntimeDirs(config);

  const schemaOutFile = path.join(config.stateDir, 'schema.generated.json');
  await writeText(schemaOutFile, `${JSON.stringify(project.schema, null, 2)}\n`);
  logs.push(`Generated ${path.relative(config.cwd, schemaOutFile)}`);

  if (config.types?.enabled !== false) {
    const result = await generateTypes(config, { project });
    for (const outFile of result.outFiles) {
      logs.push(`Generated ${path.relative(config.cwd, outFile)}`);
    }
  }

  const sourceMetadataPath = path.join(config.stateDir, 'state', '.sources.json');
  const sourceMetadata = await readJsonState(sourceMetadataPath, { resources: {} });
  sourceMetadata.resources ??= {};

  for (const resource of project.resources) {
    await syncStateResource(config, resource, sourceMetadata);
  }
  await writeJsonState(sourceMetadataPath, sourceMetadata);

  logs.push('Synced runtime mirror');

  return {
    ...project,
    logs,
  };
}

async function ensureRuntimeDirs(config) {
  await mkdir(config.stateDir, { recursive: true });
  await mkdir(path.join(config.stateDir, 'state'), { recursive: true });
  await mkdir(path.join(config.stateDir, 'wal'), { recursive: true });
  await mkdir(path.join(config.stateDir, 'migrations'), { recursive: true });
  await mkdir(path.join(config.stateDir, 'types'), { recursive: true });
}

async function syncStateResource(config, resource, sourceMetadata) {
  const statePath = statePathForResource(config, resource.name);
  const existing = await readJsonState(statePath, undefined);
  const metadata = sourceMetadata.resources[resource.name];
  const sourceChanged = resource.dataHash
    && metadata?.hash !== resource.dataHash;

  if (existing === undefined || sourceChanged) {
    await writeJsonState(statePath, applyDefaultsToSeed(seedForRuntimeState(resource, config), resource, config));
    updateSourceMetadata(sourceMetadata, config, resource);
    return;
  }

  if (config.defaults?.applyOnSafeMigration !== false) {
    await writeJsonState(statePath, applyDefaultsToSeed(existing, resource, config));
  }

  updateSourceMetadata(sourceMetadata, config, resource);
}

function updateSourceMetadata(sourceMetadata, config, resource) {
  if (!resource.dataHash) {
    return;
  }

  sourceMetadata.resources[resource.name] = {
    path: path.relative(config.cwd, resource.dataPath),
    format: resource.dataFormat,
    hash: resource.dataHash,
    updatedAt: new Date().toISOString(),
  };
}

async function writeGeneratedIdsToSources(config, resources, logs) {
  if (config.mode === 'mirror') {
    return;
  }

  for (const resource of resources) {
    if (!resource.generatedIds || resource.dataFormat !== 'json' || !resource.dataPath) {
      continue;
    }

    const text = `${JSON.stringify(resource.seed, null, 2)}\n`;
    await writeText(resource.dataPath, text);
    resource.dataHash = createHash('sha256').update(text).digest('hex');
    resource.generatedIds = false;
    logs.push(`Updated ${path.relative(config.cwd, resource.dataPath)} with generated ids`);
  }
}

export function applyDefaultsToSeed(seed, resource, config) {
  if (config.defaults?.applyOnSafeMigration === false) {
    return seed;
  }

  if (resource.kind === 'collection') {
    return Array.isArray(seed) ? seed.map((record) => applyDefaultsToRecord(record, resource)) : [];
  }

  return applyDefaultsToRecord(seed, resource);
}

export function applyDefaultsToRecord(record, resource) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return record;
  }

  const next = { ...record };
  for (const [fieldName, field] of Object.entries(resource.fields ?? {})) {
    if (next[fieldName] === undefined && 'default' in field) {
      next[fieldName] = structuredClone(field.default);
    }
  }

  return next;
}

function seedForRuntimeState(resource, config) {
  if (shouldGenerateSeedFromSchema(resource, config)) {
    return generateSyntheticSeed(resource, syntheticSeedCount(config));
  }
  return resource.seed;
}

function shouldGenerateSeedFromSchema(resource, config) {
  if (config.seed?.generateFromSchema !== true) {
    return false;
  }

  if (resource.dataPath || !resource.schemaPath) {
    return false;
  }

  if (resource.kind === 'collection') {
    return Array.isArray(resource.seed) && resource.seed.length === 0;
  }

  return isPlainObject(resource.seed) && Object.keys(resource.seed).length === 0;
}

function syntheticSeedCount(config) {
  const value = Number(config.seed?.generatedCount);
  if (!Number.isFinite(value)) {
    return 5;
  }
  return Math.max(0, Math.floor(value));
}

function generateSyntheticSeed(resource, count) {
  if (resource.kind === 'collection') {
    return Array.from({ length: count }, (_unused, index) => generateSyntheticRecord(resource, index));
  }
  return generateSyntheticRecord(resource, 0);
}

function generateSyntheticRecord(resource, index) {
  const record = {};
  for (const [fieldName, field] of Object.entries(resource.fields ?? {})) {
    if (fieldName === resource.idField) {
      record[fieldName] = String(index + 1);
      continue;
    }
    const value = syntheticValue(field, fieldName, index);
    if (value !== undefined) {
      record[fieldName] = value;
    }
  }
  return record;
}

function syntheticValue(field, fieldName, index) {
  if (!field || typeof field !== 'object' || Array.isArray(field)) {
    return null;
  }

  if ('default' in field) {
    return structuredClone(field.default);
  }

  if (field.type === 'enum' && Array.isArray(field.values) && field.values.length > 0) {
    return field.values[index % field.values.length];
  }

  switch (field.type) {
    case 'string':
      return `${fieldName}_${index + 1}`;
    case 'datetime':
      return new Date(Date.UTC(2020, 0, index + 1)).toISOString();
    case 'number':
      return index + 1;
    case 'boolean':
      return index % 2 === 0;
    case 'array':
      return field.items ? [syntheticValue(field.items, `${fieldName}Item`, index)].filter((item) => item !== undefined) : [];
    case 'object': {
      const objectValue = {};
      for (const [childName, childField] of Object.entries(field.fields ?? {})) {
        const childValue = syntheticValue(childField, childName, index);
        if (childValue !== undefined) {
          objectValue[childName] = childValue;
        }
      }
      return objectValue;
    }
    default:
      return null;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
