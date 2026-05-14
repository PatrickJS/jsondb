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

function schemaSourceForResource(resource) {
  const source = {
    kind: resource.kind,
    fields: resource.fields,
  };

  if (resource.kind === 'collection') {
    source.idField = resource.idField;
  }

  return source;
}

function positionalArgs(args) {
  const output = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--out' || arg === '--cwd' || arg === '--config') {
      index += 1;
      continue;
    }
    if (!String(arg).startsWith('-')) {
      output.push(arg);
    }
  }
  return output;
}
