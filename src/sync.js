import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { loadProjectSchema } from './schema.js';
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

  for (const resource of project.resources) {
    await syncStateResource(config, resource);
  }

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

async function syncStateResource(config, resource) {
  const statePath = statePathForResource(config, resource.name);
  const existing = await readJsonState(statePath, undefined);

  if (existing === undefined) {
    await writeJsonState(statePath, applyDefaultsToSeed(resource.seed, resource, config));
    return;
  }

  if (config.defaults?.applyOnSafeMigration !== false) {
    await writeJsonState(statePath, applyDefaultsToSeed(existing, resource, config));
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
