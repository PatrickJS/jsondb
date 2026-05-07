export default {
  sourceDir: './db',
  stateDir: './.jsondb',
  mode: 'mirror',
  types: {
    enabled: true,
    outFile: './.jsondb/types/index.ts',
    commitOutFile: './src/generated/jsondb.types.ts',
    emitComments: true,
  },
  schema: {
    unknownFields: 'warn',
  },
};
