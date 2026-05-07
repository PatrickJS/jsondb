#!/usr/bin/env node
import { watch } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { openJsonFixtureDb } from './db.js';
import { loadProjectSchema } from './schema.js';
import { startJsonDbServer } from './server.js';
import { syncJsonFixtureDb } from './sync.js';
import { generateTypes } from './types.js';

main().catch((error) => {
  if (error.diagnostics) {
    for (const diagnostic of error.diagnostics) {
      printDiagnostic(diagnostic);
    }
  }

  console.error(error.message);
  process.exitCode = 1;
});

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] ?? 'help';

  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === '--version' || command === '-v') {
    console.log('0.1.0');
    return;
  }

  const config = await loadConfig(parseGlobalOptions(args));

  switch (command) {
    case 'sync':
      await runSync(config);
      break;
    case 'types':
      await runTypes(config, args.slice(1));
      break;
    case 'schema':
      await runSchema(config, args.slice(1));
      break;
    case 'create':
      await runCreate(config, args.slice(1));
      break;
    case 'serve':
      await runServe(config, args.slice(1));
      break;
    default:
      throw new Error(`Unknown command "${command}". Run "jsondb help".`);
  }
}

async function runSync(config) {
  const result = await syncJsonFixtureDb(config);
  for (const diagnostic of result.diagnostics) {
    printDiagnostic(diagnostic);
  }
  for (const line of result.logs) {
    console.log(line);
  }
}

async function runTypes(config, args) {
  if (args.includes('--watch')) {
    await runTypesOnce(config, args);
    console.log(`Watching ${path.relative(config.cwd, config.sourceDir) || '.'}`);
    watch(config.sourceDir, { recursive: false }, async () => {
      try {
        await runTypesOnce(config, args);
      } catch (error) {
        console.error(error.message);
      }
    });
    return new Promise(() => {});
  }

  await runTypesOnce(config, args);
}

async function runTypesOnce(config, args) {
  const outFile = valueAfter(args, '--out');
  const project = await loadProjectSchema(config);
  const result = await generateTypes(config, { project, outFile });

  for (const diagnostic of result.diagnostics) {
    printDiagnostic(diagnostic);
  }

  for (const filePath of result.outFiles) {
    console.log(`Generated ${path.relative(config.cwd, filePath)}`);
  }
}

async function runSchema(config, args) {
  const project = await loadProjectSchema(config);

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
    const resource = project.schema.resources[args[0]];
    if (!resource) {
      throw new Error(`Unknown schema resource "${args[0]}"`);
    }

    console.log(JSON.stringify(resource, null, 2));
    return;
  }

  console.log(JSON.stringify(project.schema, null, 2));
}

async function runCreate(config, args) {
  const [collectionName, json] = args;
  if (!collectionName || !json) {
    throw new Error('Usage: jsondb create <collection> <json>');
  }

  const db = await openJsonFixtureDb({
    ...config,
    syncOnOpen: true,
  });
  const record = await db.collection(collectionName).create(JSON.parse(json));
  console.log(JSON.stringify(record, null, 2));
}

async function runServe(config, args) {
  const host = valueAfter(args, '--host') ?? config.server.host;
  const port = valueAfter(args, '--port') ?? config.server.port;
  const { url } = await startJsonDbServer({
    ...config,
    host,
    port,
  });
  console.log(`jsondb server listening at ${url}`);
  return new Promise(() => {});
}

function parseGlobalOptions(args) {
  return {
    cwd: valueAfter(args, '--cwd') ?? process.cwd(),
    configPath: valueAfter(args, '--config'),
  };
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

function printDiagnostic(diagnostic) {
  const prefix = diagnostic.severity === 'error' ? 'error' : 'warn';
  console.error(`${prefix}: ${diagnostic.message}`);
}

function printHelp() {
  console.log(`jsondb

Usage:
  jsondb sync
  jsondb types [--watch] [--out <file>]
  jsondb schema [resource]
  jsondb schema validate
  jsondb create <collection> <json>
  jsondb serve [--host <host>] [--port <port>]

Options:
  --cwd <dir>       Project directory
  --config <file>   Config file path
`);
}
