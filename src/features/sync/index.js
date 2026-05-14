import path from 'node:path';
import { loadProjectSchema, makeGeneratedSchema } from '../../schema.js';
import { generateSchemaManifest } from '../../schema-manifest.js';
import { generateTypes } from '../../types.js';
import { readJsonState, writeJsonState } from '../runtime/state.js';
import { writeText } from '../../fs-utils.js';
import { syncStateResource } from './mirror-state.js';
import { ensureRuntimeDirs } from './runtime-dirs.js';
import { writeGeneratedIdsToSources } from './source-writes.js';

export { applyDefaultsToRecord, applyDefaultsToSeed } from './defaults.js';

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

  if (config.schemaOutFile) {
    const result = await generateSchemaManifest(config, { project });
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
