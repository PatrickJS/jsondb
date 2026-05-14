#!/usr/bin/env node
import { watch } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { runJsonDbDoctor } from './doctor.js';
import { openJsonFixtureDb } from './db.js';
import { generateHonoStarter } from './generate/hono.js';
import { loadProjectSchema } from './schema.js';
import { generateSchemaManifest } from './schema-manifest.js';
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
    case 'doctor':
    case 'check':
      await runDoctor(config, args.slice(1));
      break;
    case 'create':
      await runCreate(config, args.slice(1));
      break;
    case 'serve':
      await runServe(config, args.slice(1));
      break;
    case 'generate':
      await runGenerate(config, args.slice(1));
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
    watch(config.sourceDir, { recursive: true }, async () => {
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
    const resource = project.schema.resources[args[0]];
    if (!resource) {
      throw new Error(`Unknown schema resource "${args[0]}"`);
    }

    console.log(JSON.stringify(resource, null, 2));
    return;
  }

  console.log(JSON.stringify(project.schema, null, 2));
}

async function runDoctor(config, args) {
  const result = await runJsonDbDoctor(config);

  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printDoctorResult(result);
  }

  if (result.summary.error > 0 || (args.includes('--strict') && result.summary.warn > 0)) {
    process.exitCode = 1;
  }
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

async function runGenerate(config, args) {
  const target = args[0];
  if (target !== 'hono') {
    throw new Error('Usage: jsondb generate hono [--out <dir>] [--api <rest|graphql|rest,graphql|none>] [--db sqlite] [--app <standalone|module>] [--seed fixtures] [--allow-warnings]');
  }

  const result = await generateHonoStarter(config, {
    outDir: valueAfter(args, '--out'),
    api: valueAfter(args, '--api'),
    db: valueAfter(args, '--db'),
    app: valueAfter(args, '--app'),
    seed: valueAfter(args, '--seed'),
    allowWarnings: args.includes('--allow-warnings') ? true : undefined,
  });

  for (const filePath of result.files) {
    console.log(`Generated ${path.relative(config.cwd, filePath)}`);
  }
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

function printDoctorResult(result) {
  if (result.findings.length === 0) {
    console.log('jsondb doctor found no issues');
    return;
  }

  console.log(`jsondb doctor found ${result.findings.length} finding${result.findings.length === 1 ? '' : 's'}`);
  for (const finding of result.findings) {
    console.log(`${finding.severity}: ${finding.code}: ${finding.message}`);
    if (finding.hint) {
      console.log(`  hint: ${finding.hint}`);
    }
  }
}

function printHelp() {
  console.log(`jsondb

Usage:
  jsondb sync
  jsondb types [--watch] [--out <file>]
  jsondb schema [resource]
  jsondb schema manifest [--out <file>]
  jsondb schema validate
  jsondb doctor [--strict] [--json]
  jsondb check [--strict] [--json]
  jsondb create <collection> <json>
  jsondb serve [--host <host>] [--port <port>]
  jsondb generate hono [--out <dir>] [--api <targets>] [--app <shape>]

Options:
  --cwd <dir>       Project directory
  --config <file>   Config file path
`);
}
