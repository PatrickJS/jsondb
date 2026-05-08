import type { JsonDbOptions } from './index.d.ts';

export type JsonDbHonoOptions = JsonDbOptions & {
  api?: Array<'rest' | 'graphql'> | 'rest' | 'graphql' | 'rest,graphql';
  graphqlPath?: string;
  storage?: {
    kind?: 'jsondb' | 'sqlite';
    file?: string;
  };
};

export function createJsonDbHonoApp(options?: JsonDbHonoOptions): Promise<unknown>;
export function createJsonDbContext(options?: JsonDbHonoOptions): Promise<unknown>;
export function jsonDbContext(dbOrOptions?: unknown): unknown;
