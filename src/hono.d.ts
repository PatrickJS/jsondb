import type { JsonDbOptions } from './index.d.ts';

export type JsonDbHonoOptions = JsonDbOptions & {
  api?: Array<'rest' | 'graphql'> | 'rest' | 'graphql' | 'rest,graphql';
  graphqlPath?: string;
  restRoutes?: JsonDbHonoRestRoutesOptions;
  storage?: {
    kind?: 'jsondb' | 'sqlite';
    file?: string;
  };
};

export type JsonDbHonoRestMethod = 'list' | 'get' | 'create' | 'patch' | 'delete' | 'put';

export type JsonDbHonoRestHookContext = {
  c: unknown;
  db: unknown;
  resource: Record<string, unknown>;
  resourceName: string;
  method: JsonDbHonoRestMethod;
  id?: string;
  body?: Record<string, unknown>;
};

export type JsonDbHonoRestHook = (context: JsonDbHonoRestHookContext) => unknown | Promise<unknown>;

export type JsonDbHonoRestHooks = {
  beforeList?: JsonDbHonoRestHook;
  beforeGet?: JsonDbHonoRestHook;
  beforeCreate?: JsonDbHonoRestHook;
  beforePatch?: JsonDbHonoRestHook;
  beforeDelete?: JsonDbHonoRestHook;
  beforePut?: JsonDbHonoRestHook;
};

export type JsonDbHonoRestLifecycleHooks = {
  beforeRequest?: JsonDbHonoRestHook;
  beforeWrite?: JsonDbHonoRestHook;
};

export type JsonDbHonoRestResourceOptions = false | {
  methods?: JsonDbHonoRestMethod[];
  hooks?: JsonDbHonoRestHooks;
};

export type JsonDbHonoRestRoutesOptions = {
  prefix?: string;
  resources?: string[];
  exclude?: string[];
  methods?: JsonDbHonoRestMethod[];
  hooks?: JsonDbHonoRestHooks;
  lifecycleHooks?: JsonDbHonoRestLifecycleHooks;
  resourceOptions?: Record<string, JsonDbHonoRestResourceOptions>;
};

export function createJsonDbHonoApp(options?: JsonDbHonoOptions): Promise<unknown>;
export function createJsonDbContext(options?: JsonDbHonoOptions): Promise<unknown>;
export function jsonDbContext(dbOrOptions?: unknown): unknown;
export function registerRestRoutes(app: unknown, db: unknown, options?: JsonDbHonoRestRoutesOptions): void;
