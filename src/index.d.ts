import type { IncomingMessage, Server, ServerResponse } from 'node:http';

export type JsonDbTypeMap = {
  collections: Record<string, unknown>;
  documents: Record<string, unknown>;
};

export type JsonDbGeneratedTypesOptions = {
  /** Generate TypeScript types during sync. */
  enabled?: boolean;
  /** Gitignored generated type output. Defaults to "./.jsondb/types/index.ts". */
  outFile?: string;
  /** Optional committed copy for app/CI imports. */
  commitOutFile?: string | null;
  /** Emit readonly object properties in generated types. */
  useReadonly?: boolean;
  /** Emit JSDoc from schema field descriptions. */
  emitComments?: boolean;
  /** Export JsonDbCollections, JsonDbDocuments, and JsonDbTypes helpers. */
  exportRuntimeHelpers?: boolean;
};

export type JsonDbSchemaManifestFieldContext = {
  field: Record<string, unknown>;
  fieldName: string;
  resource: Record<string, unknown>;
  resourceName: string;
  path: string;
  file: string | null;
  sourceFile: string | null;
  defaultManifest: Record<string, unknown>;
};

export type JsonDbSchemaManifestResourceContext = {
  resource: Record<string, unknown>;
  resourceName: string;
  file: string | null;
  sourceFile: string | null;
  defaultManifest: Record<string, unknown>;
};

export type JsonDbSchemaManifestOptions = {
  /** Customize generated resource manifest entries. */
  customizeResource?: (context: JsonDbSchemaManifestResourceContext) => Record<string, unknown>;
  /** Customize or omit generated field manifest entries. Return null to omit a field. */
  customizeField?: (context: JsonDbSchemaManifestFieldContext) => Record<string, unknown> | null;
};

export type JsonDbResourceNamingStrategy = 'basename' | 'folder-prefixed' | 'path';

export type JsonDbResourceCustomizeContext = {
  file: string;
  sourceFile: string;
  basename: string;
  folder: string | null;
  folders: string[];
  extension: string;
  defaultName: string;
  defaultResource: {
    name: string;
  };
};

export type JsonDbResourceOptions = {
  /** How fixture paths become resource names. Defaults to "basename". */
  naming?: JsonDbResourceNamingStrategy;
  /** Customize fixture path -> resource identity. */
  customizeResource?: (context: JsonDbResourceCustomizeContext) => { name?: string } | null | undefined;
};

export type JsonDbRestFormatContext = {
  db: unknown;
  resource: Record<string, unknown>;
  resourceName: string;
  data: unknown;
  format: string;
  request: IncomingMessage | Record<string, unknown>;
  url: URL;
};

export type JsonDbRestFormatResult = string | Buffer | {
  status?: number;
  body?: string | Buffer;
  contentType?: string;
  headers?: Record<string, string>;
};

export type JsonDbRestFormatRenderer = (context: JsonDbRestFormatContext) => JsonDbRestFormatResult | Promise<JsonDbRestFormatResult>;

export type JsonDbOptions = {
  /** Project root used to resolve relative config paths. Defaults to process.cwd(). */
  cwd?: string;
  /** Explicit config file path. Defaults to jsondb.config.mjs/js lookup from cwd. */
  configPath?: string;
  /** Fixture source folder. Defaults to "./db". */
  dbDir?: string;
  /** Backwards-compatible fixture source folder alias. If set, it wins over dbDir. */
  sourceDir?: string;
  /** Generated runtime output folder. Defaults to "./.jsondb". */
  stateDir?: string;
  /** Optional committed generated JSON schema manifest for admin/CMS UI generation. */
  schemaOutFile?: string | null;
  /** Optional visitor hooks for customizing generated schema manifest output. */
  schemaManifest?: JsonDbSchemaManifestOptions;
  /** "mirror" keeps source fixtures unchanged; "source" may write generated ids back to plain .json fixtures. */
  mode?: 'mirror' | 'source';
  /** Run sync automatically when opening the package API. */
  syncOnOpen?: boolean;
  /** Keep valid resources available when one source file has diagnostics. */
  allowSourceErrors?: boolean;
  types?: JsonDbGeneratedTypesOptions;
  schema?: {
    /** Which inputs define schemas. "auto" uses schema files when present and otherwise infers from data. */
    source?: 'auto' | 'data' | 'schema';
    /** Allow JSONC source files. */
    allowJsonc?: boolean;
    /** How schema-backed resources handle fields not declared by schema. */
    unknownFields?: 'allow' | 'warn' | 'error';
    /** Future migration policy for safe additive changes. */
    additiveChanges?: 'auto' | 'manual';
    /** Future migration policy for destructive changes. */
    destructiveChanges?: 'manual';
    /** Future migration policy for field type changes. */
    typeChanges?: 'manual';
  };
  defaults?: {
    /** Apply schema defaults on create through package, REST, and GraphQL writes. */
    applyOnCreate?: boolean;
    /** Apply defaults during safe additive mirror sync. */
    applyOnSafeMigration?: boolean;
  };
  seed?: {
    /** Generate mock runtime rows for schema-only resources with empty seed data. */
    generateFromSchema?: boolean;
    /** Number of mock rows to generate when generateFromSchema is true. */
    generatedCount?: number;
  };
  /** Per-collection overrides such as custom id field names. */
  collections?: Record<string, { idField?: string }>;
  /** Resource naming and fixture path identity options. */
  resources?: JsonDbResourceOptions;
  server?: {
    /** Local HTTP host. Defaults to "127.0.0.1". */
    host?: string;
    /** Local HTTP port. Defaults to 7331. */
    port?: number;
    /** Maximum JSON request body size in bytes. Defaults to 1048576. */
    maxBodyBytes?: number;
  };
  rest?: {
    /** Enable generated REST routes. */
    enabled?: boolean;
    /** GET response formats by extension. "default" controls extensionless resource routes. */
    formats?: Record<string, JsonDbRestFormatRenderer | string | undefined>;
  };
  graphql?: {
    /** Enable the focused dependency-free GraphQL endpoint. */
    enabled?: boolean;
    /** GraphQL HTTP path. Defaults to "/graphql". */
    path?: string;
  };
  mock?: {
    /** Local response delay in ms, [minMs, maxMs], or an object range. Defaults to [30, 100]. Use 0 to disable. */
    delay?: number | [number, number] | {
      minMs?: number;
      maxMs?: number;
      min?: number;
      max?: number;
    } | null;
    /** Random local error rate or detailed error settings. Defaults to no random errors. */
    errors?: number | {
      rate?: number;
      probability?: number;
      status?: number;
      message?: string;
    } | null;
  };
  /** Named database forks, usually stored under ./db.forks/<name>. */
  forks?: string[] | Record<string, string | {
    /** Fork fixture source folder. Defaults to "./db.forks/<name>". */
    dbDir?: string;
    /** Backwards-compatible source folder alias. If set, it wins over dbDir. */
    sourceDir?: string;
    /** Fork generated runtime output folder. Defaults to "./.jsondb/forks/<name>". */
    stateDir?: string;
    /** Fork-specific generated type output. Committed type output is disabled by default for forks. */
    types?: JsonDbGeneratedTypesOptions;
  }>;
  generate?: {
    hono?: {
      /** Output folder for generated starter code. */
      outDir?: string;
      /** API modules to generate. */
      api?: Array<'rest' | 'graphql'> | 'rest' | 'graphql' | 'rest,graphql' | 'none';
      db?: 'sqlite';
      app?: 'standalone' | 'module';
      runtime?: 'node-sqlite';
      /** Include fixture seed support in generated starter code. */
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
  /** Target a configured database fork, such as "legacy-demo". */
  fork?: string;
  restBasePath?: string;
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

export type JsonDbDoctorSeverity = 'error' | 'warn' | 'info';

export type JsonDbDoctorFinding = {
  code: string;
  severity: JsonDbDoctorSeverity;
  source?: 'schema' | 'doctor' | string;
  resource?: string;
  field?: string;
  message: string;
  hint?: string;
  details?: Record<string, unknown>;
};

export type JsonDbDoctorResult = {
  summary: {
    error: number;
    warn: number;
    info: number;
  };
  findings: JsonDbDoctorFinding[];
};

export type JsonDbRequestHandlerOptions = {
  /** Scoped base for jsondb dev tools. Defaults to "/__jsondb". */
  apiBase?: string;
  /** Serve root REST routes such as "/users". Defaults to true for standalone handlers. */
  rootRoutes?: boolean;
  /** Scoped REST resource base, such as "/__jsondb/rest". */
  restBasePath?: string;
  /** GraphQL endpoint path. Defaults to configured graphql.path or "/graphql". */
  graphqlPath?: string;
};

export type JsonDbRequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  next?: () => void,
) => Promise<boolean>;

export type JsonDbServer = {
  server: Server;
  db: JsonFixtureDb;
  url: string;
};

export function openJsonFixtureDb<Types extends JsonDbTypeMap = JsonDbTypeMap>(options?: JsonDbOptions): Promise<JsonFixtureDb<Types>>;
export function createJsonDbClient(options?: JsonDbClientOptions): JsonDbClient;
export function createJsonDbRequestHandler(db: JsonFixtureDb, options?: JsonDbRequestHandlerOptions): JsonDbRequestHandler;
export function loadConfig(options?: JsonDbOptions): Promise<JsonDbOptions>;
export function runJsonDbDoctor(config: JsonDbOptions): Promise<JsonDbDoctorResult>;
export function startJsonDbServer(options?: JsonDbOptions & { host?: string; port?: number }): Promise<JsonDbServer>;
export function syncJsonFixtureDb(config: JsonDbOptions, options?: { allowErrors?: boolean }): Promise<unknown>;
export function generateTypes(config: JsonDbOptions, options?: { outFile?: string }): Promise<{ content: string; outFiles: string[] }>;
export function generateSchemaManifest(config: JsonDbOptions, options?: { outFile?: string }): Promise<{ manifest: unknown; content: string; outFiles: string[] }>;
export function renderSchemaManifest(resources: unknown[], config?: JsonDbOptions): unknown;
export function mergeManifest(base: unknown, patch: unknown): unknown;
export function resourceNameFromPath(file: string, options?: { strategy?: JsonDbResourceNamingStrategy }): string;
export function parseFixturePath(file: string): {
  file: string;
  folders: string[];
  folder: string | null;
  filename: string;
  basename: string;
  extension: string;
};
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
