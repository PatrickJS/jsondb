import path from 'node:path';
import { jsonDbError, listChoices } from '../../errors.js';
import { writeText } from '../../fs-utils.js';
import { resolveResource } from '../../names.js';
import { loadProjectSchema } from '../../schema.js';
import { generateSchemaManifest } from '../../schema-manifest.js';
import { isHelpRequested, valueAfter } from '../args.js';
import { printDiagnostic, printSchemaHelp } from '../output.js';

export async function runSchema(config, args) {
  if (isHelpRequested(args)) {
    printSchemaHelp();
    return;
  }

  if (args[0] === 'infer') {
    await runSchemaInfer(config, args);
    return;
  }

  const project = await loadProjectSchema(config);

  if (args[0] === 'manifest') {
    const result = await generateSchemaManifest(config, {
      project,
      outFile: valueAfter(args, '--out'),
    });

    if (result.outFiles.length === 0) {
      console.log(result.content);
      return;
    }

    for (const filePath of result.outFiles) {
      console.log(`Generated ${path.relative(config.cwd, filePath)}`);
    }
    return;
  }

  if (args[0] === 'unbundle') {
    await runSchemaUnbundle(config, project, args);
    return;
  }

  if (args[0] === 'bundle') {
    await runSchemaBundle(config, project, args);
    return;
  }

  if (args[0] === 'validate') {
    for (const diagnostic of project.diagnostics) {
      printDiagnostic(diagnostic);
    }

    const errorCount = project.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
    if (errorCount > 0) {
      process.exitCode = 1;
      return;
    }

    console.log(project.diagnostics.length === 0 ? 'Schema valid' : 'Schema valid with warnings');
    return;
  }

  if (args[0]) {
    const resourceMap = new Map(project.resources.map((resource) => [resource.name, resource]));
    const { resource, candidates } = resolveResource(resourceMap, args[0]);
    if (!resource) {
      throw jsonDbError(
        'SCHEMA_UNKNOWN_RESOURCE',
        `Unknown schema resource "${args[0]}".`,
        {
          status: 404,
          hint: `Use one of: ${listChoices(project.resources.map((resource) => resource.name))}.`,
          details: {
            resource: args[0],
            requestedResource: args[0],
            normalizedCandidates: candidates,
            availableResources: project.resources.map((resource) => resource.name),
          },
        },
      );
    }

    console.log(JSON.stringify(project.schema.resources[resource.name], null, 2));
    return;
  }

  console.log(JSON.stringify(project.schema, null, 2));
}

async function runSchemaUnbundle(config, project, args) {
  const resourceName = positionalArgs(args.slice(1))[0];
  if (!resourceName) {
    throw jsonDbError(
      'SCHEMA_UNBUNDLE_REQUIRES_RESOURCE',
      'SCHEMA_UNBUNDLE_REQUIRES_RESOURCE: schema unbundle requires a resource name.',
      {
        hint: 'Use jsondb schema unbundle users.',
      },
    );
  }

  const resource = requireSchemaResource(project, resourceName);
  const explicitSchemaOutFile = outputPath(config, valueAfter(args, '--schema-out'));
  if (!explicitSchemaOutFile && resource.schemaPath?.endsWith('.schema.mjs')) {
    throw jsonDbError(
      'SCHEMA_UNBUNDLE_SCHEMA_MJS_REQUIRES_OUT',
      `SCHEMA_UNBUNDLE_SCHEMA_MJS_REQUIRES_OUT: schema unbundle cannot rewrite ${path.relative(config.cwd, resource.schemaPath)} in place.`,
      {
        hint: 'Use --schema-out to write a JSON/JSONC schema source, then replace the .schema.mjs file when you are ready.',
      },
    );
  }

  const schemaOutFile = explicitSchemaOutFile ?? defaultSchemaOutFile(config, resource);
  const explicitSeedOutFile = outputPath(config, valueAfter(args, '--seed-out'));
  const shouldWriteSeed = explicitSeedOutFile !== undefined || !resource.dataPath;
  const seedOutFile = explicitSeedOutFile ?? defaultSeedOutFile(config, resource);
  const generated = [];

  if (shouldWriteSeed) {
    await writeText(seedOutFile, `${JSON.stringify(resource.seed, null, 2)}\n`);
    generated.push(seedOutFile);
  }

  await writeText(schemaOutFile, `${JSON.stringify(schemaSourceForResource(resource), null, 2)}\n`);
  generated.push(schemaOutFile);

  for (const filePath of generated) {
    console.log(`Generated ${path.relative(config.cwd, filePath)}`);
  }
}

async function runSchemaBundle(config, project, args) {
  const resourceName = positionalArgs(args.slice(1))[0];
  if (!resourceName) {
    throw jsonDbError(
      'SCHEMA_BUNDLE_REQUIRES_RESOURCE',
      'SCHEMA_BUNDLE_REQUIRES_RESOURCE: schema bundle requires a resource name.',
      {
        hint: 'Use jsondb schema bundle users --out db/users.bundle.schema.json.',
      },
    );
  }

  const resource = requireSchemaResource(project, resourceName);
  const content = `${JSON.stringify(schemaSourceForResource(resource, { includeSeed: true }), null, 2)}\n`;
  const outFile = outputPath(config, valueAfter(args, '--out'));
  if (!outFile) {
    console.log(content.trimEnd());
    return;
  }

  await writeText(outFile, content);
  console.log(`Generated ${path.relative(config.cwd, outFile)}`);
}

async function runSchemaInfer(config, args) {
  const resourceName = positionalArgs(args.slice(1))[0];
  const outFile = valueAfter(args, '--out');
  const inferredConfig = {
    ...config,
    schema: {
      ...config.schema,
      source: 'data',
    },
  };
  const project = await loadProjectSchema(inferredConfig);

  if (outFile && !resourceName) {
    throw jsonDbError(
      'SCHEMA_INFER_OUT_REQUIRES_RESOURCE',
      'SCHEMA_INFER_OUT_REQUIRES_RESOURCE: schema infer --out requires a resource name.',
      {
        hint: 'Use jsondb schema infer users --out db/users.schema.jsonc.',
      },
    );
  }

  if (resourceName) {
    const resource = requireSchemaResource(project, resourceName);
    if (outFile) {
      const outputPath = path.resolve(config.cwd, outFile);
      await writeText(outputPath, `${JSON.stringify(schemaSourceForResource(resource), null, 2)}\n`);
      console.log(`Generated ${path.relative(config.cwd, outputPath)}`);
      return;
    }

    console.log(JSON.stringify(project.schema.resources[resource.name], null, 2));
    return;
  }

  console.log(JSON.stringify(project.schema, null, 2));
}

function requireSchemaResource(project, name) {
  const resourceMap = new Map(project.resources.map((resource) => [resource.name, resource]));
  const { resource, candidates } = resolveResource(resourceMap, name);
  if (!resource) {
    throw jsonDbError(
      'SCHEMA_UNKNOWN_RESOURCE',
      `Unknown schema resource "${name}".`,
      {
        status: 404,
        hint: `Use one of: ${listChoices(project.resources.map((resource) => resource.name))}.`,
        details: {
          resource: name,
          requestedResource: name,
          normalizedCandidates: candidates,
          availableResources: project.resources.map((resource) => resource.name),
        },
      },
    );
  }
  return resource;
}

function schemaSourceForResource(resource, options = {}) {
  const source = {
    kind: resource.kind,
    fields: resource.fields,
  };

  if (resource.kind === 'collection') {
    source.idField = resource.idField;
  }

  if (options.includeSeed) {
    source.seed = resource.seed;
  }

  return source;
}

function outputPath(config, maybePath) {
  return maybePath ? path.resolve(config.cwd, maybePath) : undefined;
}

function defaultSchemaOutFile(config, resource) {
  if (resource.schemaPath && !resource.schemaPath.endsWith('.schema.mjs')) {
    return resource.schemaPath;
  }

  return path.join(config.sourceDir, `${resource.name}.schema.jsonc`);
}

function defaultSeedOutFile(config, resource) {
  return resource.dataPath ?? path.join(config.sourceDir, `${resource.name}.json`);
}

function positionalArgs(args) {
  const output = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--out' || arg === '--schema-out' || arg === '--seed-out' || arg === '--cwd' || arg === '--config') {
      index += 1;
      continue;
    }
    if (!String(arg).startsWith('-')) {
      output.push(arg);
    }
  }
  return output;
}
