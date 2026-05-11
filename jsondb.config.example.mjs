// @ts-check
import { defineConfig } from 'jsondb/config';

export default defineConfig({
  // Fixture source folder. Defaults to './db'.
  dbDir: './db',

  // Runtime output folder. Defaults to './.jsondb'.
  stateDir: './.jsondb',

  // mirror: keep source fixtures unchanged and write app edits to .jsondb/state.
  // source: write generated ids back to plain .json fixtures when needed.
  mode: 'mirror',

  // Generated TypeScript types. The default outFile is gitignored; commitOutFile
  // is useful when app code imports generated types in CI or fresh checkouts.
  types: {
    enabled: true,
    outFile: './.jsondb/types/index.ts',
    commitOutFile: null,
    useReadonly: false,
    emitComments: true,
  },

  // Default local development behavior is permissive: unknown schema-backed
  // fields warn. Use 'error' when you want schema drift to fail sync/writes.
  schema: {
    unknownFields: 'warn',
  },

  // Optional schema-only mock records. Leave off when real fixture data exists.
  seed: {
    generateFromSchema: false,
    generatedCount: 5,
  },

  // Local server settings.
  server: {
    host: '127.0.0.1',
    port: 7331,
    maxBodyBytes: 1048576,
  },

  // Local latency is on by default so loading states are visible. Use 0 to
  // disable delay, 50 for a fixed 50ms delay, or [50, 300] for a range.
  // Random errors are off by default.
  mock: {
    delay: [30, 100],
    errors: null,
  },
});
