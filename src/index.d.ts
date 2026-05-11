export type JsonDbTypeMap = {
  collections: Record<string, unknown>;
  documents: Record<string, unknown>;
};

export type JsonDbOptions = {
  cwd?: string;
  configPath?: string;
  dbDir?: string;
  sourceDir?: string;
  stateDir?: string;
  mode?: 'mirror' | 'source';
  syncOnOpen?: boolean;
  allowSourceErrors?: boolean;
  types?: {
    enabled?: boolean;
    outFile?: string;
    commitOutFile?: string | null;
    useReadonly?: boolean;
    emitComments?: boolean;
    exportRuntimeHelpers?: boolean;
  };
  schema?: {
    source?: 'auto' | 'data' | 'schema';
    allowJsonc?: boolean;
    unknownFields?: 'allow' | 'warn' | 'error';
    additiveChanges?: 'auto' | 'manual';
    destructiveChanges?: 'manual';
    typeChanges?: 'manual';
  };
  defaults?: {
    applyOnCreate?: boolean;
    applyOnSafeMigration?: boolean;
  };
  seed?: {
    generateFromSchema?: boolean;
    generatedCount?: number;
  };
  collections?: Record<string, { idField?: string }>;
  server?: {
    host?: string;
    port?: number;
    maxBodyBytes?: number;
  };
  rest?: {
    enabled?: boolean;
  };
  graphql?: {
    enabled?: boolean;
    path?: string;
  };
  mock?: {
    delay?: number | [number, number] | {
      minMs?: number;
      maxMs?: number;
      min?: number;
      max?: number;
    } | null;
    errors?: number | {
      rate?: number;
      probability?: number;
      status?: number;
      message?: string;
    } | null;
  };
  generate?: {
    hono?: {
      outDir?: string;
      api?: Array<'rest' | 'graphql'> | 'rest' | 'graphql' | 'rest,graphql' | 'none';
      db?: 'sqlite';
      app?: 'standalone' | 'module';
      runtime?: 'node-sqlite';
      seed?: false | 'fixtures';
    };
  };
};

export type JsonDbCollection<RecordType> = {
  all(): Promise<RecordType[]>;
  get(id: string): Promise<RecordType | null>;
  create(record: RecordType): Promise<RecordType>;
  update(id: string, patch: Partial<RecordType>): Promise<RecordType | null>;
  patch(id: string, patch: Partial<RecordType>): Promise<RecordType | null>;
  delete(id: string): Promise<boolean>;
};

export type JsonDbDocument<DocumentType> = {
  all(): Promise<DocumentType>;
  get(): Promise<DocumentType>;
  get(pointer: string): Promise<unknown>;
  put(value: DocumentType): Promise<DocumentType>;
  set(pointer: string, value: unknown): Promise<unknown>;
  update(patch: Partial<DocumentType>): Promise<DocumentType>;
};

export type JsonFixtureDb<Types extends JsonDbTypeMap = JsonDbTypeMap> = {
  collection<Name extends keyof Types['collections'] & string>(name: Name): JsonDbCollection<Types['collections'][Name]>;
  document<Name extends keyof Types['documents'] & string>(name: Name): JsonDbDocument<Types['documents'][Name]>;
  resourceNames(): string[];
};

export type GraphqlRequest = {
  query: string;
  variables?: Record<string, unknown>;
};

export type GraphqlResult = {
  data: unknown;
  errors?: Array<{ message: string }>;
};

export type RestBatchRequest = {
  method?: string;
  path: string;
  body?: unknown;
};

export type RestBatchResult = {
  status: number;
  headers: Record<string, string>;
  body: unknown;
};

export type JsonDbClientOptions = {
  baseUrl?: string;
  graphqlPath?: string;
  restBatchPath?: string;
  batching?: boolean | {
    enabled?: boolean;
    delayMs?: number;
    dedupe?: boolean | 'reads' | 'all';
  };
};

export type JsonDbClientRequestOptions = {
  batch?: boolean;
};

export type JsonDbClient = {
  graphql: {
    (query: string | GraphqlRequest, variables?: Record<string, unknown>, options?: JsonDbClientRequestOptions): Promise<GraphqlResult>;
    request(query: string | GraphqlRequest, variables?: Record<string, unknown>, options?: JsonDbClientRequestOptions): Promise<GraphqlResult>;
    batch(requests: GraphqlRequest[]): Promise<GraphqlResult[]>;
  };
  rest: {
    (method: string | RestBatchRequest, path?: string, body?: unknown, options?: JsonDbClientRequestOptions): Promise<RestBatchResult>;
    request(method: string | RestBatchRequest, path?: string, body?: unknown, options?: JsonDbClientRequestOptions): Promise<RestBatchResult>;
    batch(requests: RestBatchRequest[]): Promise<RestBatchResult[]>;
    get(path: string, options?: JsonDbClientRequestOptions): Promise<RestBatchResult>;
    post(path: string, body?: unknown, options?: JsonDbClientRequestOptions): Promise<RestBatchResult>;
    patch(path: string, body?: unknown, options?: JsonDbClientRequestOptions): Promise<RestBatchResult>;
    put(path: string, body?: unknown, options?: JsonDbClientRequestOptions): Promise<RestBatchResult>;
    delete(path: string, options?: JsonDbClientRequestOptions): Promise<RestBatchResult>;
  };
};

export function openJsonFixtureDb<Types extends JsonDbTypeMap = JsonDbTypeMap>(options?: JsonDbOptions): Promise<JsonFixtureDb<Types>>;
export function createJsonDbClient(options?: JsonDbClientOptions): JsonDbClient;
export function loadConfig(options?: JsonDbOptions): Promise<JsonDbOptions>;
export function syncJsonFixtureDb(config: JsonDbOptions, options?: { allowErrors?: boolean }): Promise<unknown>;
export function generateTypes(config: JsonDbOptions, options?: { outFile?: string }): Promise<{ content: string; outFiles: string[] }>;
export function generateHonoStarter(
  config: JsonDbOptions,
  options?: {
    outDir?: string;
    api?: Array<'rest' | 'graphql'> | 'rest' | 'graphql' | 'rest,graphql' | 'none';
    db?: 'sqlite';
    app?: 'standalone' | 'module';
    seed?: false | 'fixtures';
    allowWarnings?: boolean;
  },
): Promise<{ outDir: string; files: string[]; diagnostics: unknown[] }>;
export function startJsonDbServer(options?: JsonDbOptions): Promise<{ server: unknown; db: JsonFixtureDb; url: string }>;
export function executeGraphql(
  db: JsonFixtureDb,
  request: string | GraphqlRequest,
): Promise<GraphqlResult>;
export function executeGraphql(
  db: JsonFixtureDb,
  request: GraphqlRequest[],
): Promise<GraphqlResult[]>;
export function executeGraphqlBatch(db: JsonFixtureDb, requests: GraphqlRequest[]): Promise<GraphqlResult[]>;
export function parseGraphql(query: string): unknown;
