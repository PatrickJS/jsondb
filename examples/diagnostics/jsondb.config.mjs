// @ts-check
import { defineConfig } from 'jsondb/config';

export default defineConfig({
  dbDir: './db',
  stateDir: './.jsondb',
  mode: 'mirror',
  types: {
    enabled: true,
    outFile: './.jsondb/types/index.ts',
  },
  schema: {
    unknownFields: 'warn',
  },
});
