import { buildResource } from './resource.js';
import { duplicateResourceDiagnostics, listSourceFiles, readSourceFile, trackResourceSource } from './sources.js';
import { makeGeneratedSchema } from './generated.js';
import { validateProjectRelations } from './relations.js';
import { validateResourceSeed } from './validation.js';

export async function loadProjectSchema(config) {
  const files = await listSourceFiles(config.sourceDir);
  const dataFiles = new Map();
  const schemaFiles = new Map();
  const resourceSources = new Map();
  const diagnostics = [];

  for (const filename of files) {
    const result = await readSourceFile(config, filename);
    diagnostics.push(...result.diagnostics);

    for (const source of result.sources) {
      trackResourceSource(resourceSources, source.name, source.file, source.kind);
      if (source.kind === 'schema') {
        schemaFiles.set(source.name, source);
      } else {
        dataFiles.set(source.name, source);
      }
    }
  }

  const resourceNames = [...new Set([...dataFiles.keys(), ...schemaFiles.keys()])].sort();
  const resources = [];
  diagnostics.push(...duplicateResourceDiagnostics(resourceSources));

  for (const name of resourceNames) {
    const dataSource = dataFiles.get(name);
    const schemaSource = schemaFiles.get(name);
    const rawData = dataSource?.data;
    const rawSchema = schemaSource?.schema;

    if (rawData === undefined && rawSchema === undefined) {
      continue;
    }

    const resource = buildResource({
      name,
      dataPath: dataSource?.sourceFile,
      dataFormat: dataSource?.format,
      dataHash: dataSource?.hash,
      schemaPath: schemaSource?.sourceFile,
      schemaSource: schemaSource?.format,
      rawData,
      rawSchema,
      config,
    });

    diagnostics.push(...validateResourceSeed(resource, config));
    resources.push(resource);
  }

  diagnostics.push(...validateProjectRelations(resources));

  return {
    resources,
    diagnostics,
    schema: makeGeneratedSchema(resources, diagnostics),
  };
}
