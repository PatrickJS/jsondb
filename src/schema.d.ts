export type FieldDefinition =
  | ({ type: 'string' } & FieldOptions<string>)
  | ({ type: 'number' } & FieldOptions<number>)
  | ({ type: 'boolean' } & FieldOptions<boolean>)
  | ({ type: 'enum'; values: readonly (string | number | boolean)[] } & FieldOptions<string | number | boolean>)
  | ({ type: 'object'; fields?: Record<string, FieldDefinition> } & FieldOptions<Record<string, unknown>>)
  | ({ type: 'array'; items?: FieldDefinition } & FieldOptions<unknown[]>)
  | ({ type: 'unknown' } & FieldOptions<unknown>);

export type FieldOptions<DefaultValue> = {
  required?: boolean;
  description?: string;
  default?: DefaultValue;
};

export type ResourceDefinition = {
  description?: string;
  idField?: string;
  fields: Record<string, FieldDefinition>;
  seed?: unknown;
};

export function collection(definition: ResourceDefinition): ResourceDefinition & { kind: 'collection' };
export function document(definition: ResourceDefinition): ResourceDefinition & { kind: 'document' };

export const field: {
  string(options?: FieldOptions<string>): FieldDefinition;
  number(options?: FieldOptions<number>): FieldDefinition;
  boolean(options?: FieldOptions<boolean>): FieldDefinition;
  enum<const Values extends readonly (string | number | boolean)[]>(
    values: Values,
    options?: FieldOptions<Values[number]>,
  ): FieldDefinition;
  object(fields?: Record<string, FieldDefinition>, options?: FieldOptions<Record<string, unknown>>): FieldDefinition;
  array(items?: FieldDefinition, options?: FieldOptions<unknown[]>): FieldDefinition;
  json(options?: FieldOptions<unknown>): FieldDefinition;
};
