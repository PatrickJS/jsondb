import { access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveFrom } from './fs-utils.js';

export const DEFAULT_CONFIG = {
  dbDir: './db',
  sourceDir: './db',
  stateDir: './.jsondb',
  mode: 'mirror',
  types: {
    enabled: true,
    outFile: './.jsondb/types/index.ts',
    commitOutFile: null,
    useReadonly: false,
    emitComments: true,
    exportRuntimeHelpers: true,
  },
  schema: {
    source: 'auto',
    allowJsonc: true,
    unknownFields: 'warn',
    additiveChanges: 'auto',
    destructiveChanges: 'manual',
    typeChanges: 'manual',
  },
  defaults: {
    applyOnCreate: true,
    applyOnSafeMigration: true,
  },
  seed: {
    generateFromSchema: false,
    generatedCount: 5,
  },
  collections: {},
  server: {
    host: '127.0.0.1',
    port: 7331,
    maxBodyBytes: 1048576,
  },
  rest: {
    enabled: true,
  },
  graphql: {
    enabled: true,
    path: '/graphql',
  },
  mock: {
    delay: [30, 100],
    errors: null,
  },
  generate: {
    hono: {
      outDir: './jsondb-api',
      api: ['rest'],
      db: 'sqlite',
      app: 'standalone',
      runtime: 'node-sqlite',
      seed: false,
    },
  },
};

export async function loadConfig(options = {}) {
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
  const configPath = options.configPath
    ? resolveFrom(cwd, options.configPath)
    : await findConfigPath(cwd);

  let userConfig = {};
  if (configPath) {
    const url = pathToFileURL(configPath);
    url.searchParams.set('jsondbConfigLoad', String(Date.now()));
    const module = await import(url.href);
    userConfig = module.default ?? module.config ?? {};
  }

  const inlineOptions = { ...options };
  delete inlineOptions.cwd;
  delete inlineOptions.configPath;

  const merged = mergeDeep(mergeDeep(structuredClone(DEFAULT_CONFIG), userConfig), inlineOptions);
  merged.cwd = cwd;
  merged.configPath = configPath;
  const sourceDir = hasOwnConfigValue(userConfig, 'sourceDir') || hasOwnConfigValue(inlineOptions, 'sourceDir')
    ? merged.sourceDir
    : merged.dbDir;
  merged.sourceDir = resolveFrom(cwd, sourceDir);
  merged.dbDir = merged.sourceDir;
  merged.stateDir = resolveFrom(cwd, merged.stateDir);

  if (merged.types?.outFile) {
    merged.types.outFile = resolveFrom(cwd, merged.types.outFile);
  }

  if (merged.types?.commitOutFile) {
    merged.types.commitOutFile = resolveFrom(cwd, merged.types.commitOutFile);
  }

  return merged;
}

async function findConfigPath(cwd) {
  for (const filename of ['jsondb.config.mjs', 'jsondb.config.js']) {
    const candidate = path.join(cwd, filename);
    try {
      await access(candidate);
      return candidate;
    } catch {
      // keep looking
    }
  }

  return null;
}

export function mergeDeep(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? base : override;
  }

  const output = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) {
      continue;
    }

    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = mergeDeep(output[key], value);
    } else {
      output[key] = value;
    }
  }

  return output;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwnConfigValue(config, key) {
  return Object.prototype.hasOwnProperty.call(config, key) && config[key] !== undefined;
}
