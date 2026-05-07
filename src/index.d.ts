export type JsonDbTypeMap = {
  collections: Record<string, unknown>;
  documents: Record<string, unknown>;
};

export type JsonDbOptions = {
  cwd?: string;
  configPath?: string;
  sourceDir?: string;
  stateDir?: string;
  mode?: 'mirror';
  syncOnOpen?: boolean;
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
  collections?: Record<string, { idField?: string }>;
  server?: {
    host?: string;
    port?: number;
  };
  rest?: {
    enabled?: boolean;
  };
  graphql?: {
    enabled?: boolean;
    path?: string;
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

export function openJsonFixtureDb<Types extends JsonDbTypeMap = JsonDbTypeMap>(options?: JsonDbOptions): Promise<JsonFixtureDb<Types>>;
export function loadConfig(options?: JsonDbOptions): Promise<JsonDbOptions>;
export function syncJsonFixtureDb(config: JsonDbOptions): Promise<unknown>;
export function generateTypes(config: JsonDbOptions, options?: { outFile?: string }): Promise<{ content: string; outFiles: string[] }>;
export function startJsonDbServer(options?: JsonDbOptions): Promise<{ server: unknown; db: JsonFixtureDb; url: string }>;
export function executeGraphql(
  db: JsonFixtureDb,
  request: string | { query: string; variables?: Record<string, unknown> },
): Promise<{ data: unknown; errors?: Array<{ message: string }> }>;
export function parseGraphql(query: string): unknown;
