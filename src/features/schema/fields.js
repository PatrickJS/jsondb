export function normalizeField(field, fieldName = '') {
  if (!field || typeof field !== 'object' || Array.isArray(field)) {
    return inferFieldFromValue(field, fieldName, { required: false });
  }

  const normalized = {
    type: field.type ?? 'unknown',
  };

  if ('nullable' in field) {
    normalized.nullable = Boolean(field.nullable);
  }

  if ('required' in field) {
    normalized.required = Boolean(field.required);
  }

  if ('description' in field) {
    normalized.description = String(field.description);
  }

  if ('default' in field) {
    normalized.default = field.default;
  }

  if ('unique' in field) {
    normalized.unique = Boolean(field.unique);
  }

  for (const constraintName of ['min', 'max', 'minLength', 'maxLength', 'pattern']) {
    if (constraintName in field) {
      normalized[constraintName] = field[constraintName];
    }
  }

  if (field.relation && typeof field.relation === 'object' && !Array.isArray(field.relation)) {
    normalized.relation = normalizeRelation(field.relation, fieldName);
  }

  if (field.type === 'enum') {
    normalized.values = Array.isArray(field.values) ? [...field.values] : [];
  }

  if (field.type === 'array') {
    normalized.items = normalizeField(field.items ?? { type: 'unknown' }, `${fieldName}Item`);
  }

  if (field.type === 'object' && 'additionalProperties' in field) {
    normalized.additionalProperties = Boolean(field.additionalProperties);
  }

  if (field.type === 'object' && 'discriminator' in field) {
    normalized.discriminator = String(field.discriminator);
  }

  if (field.type === 'object' && field.fields && typeof field.fields === 'object') {
    normalized.fields = Object.fromEntries(
      Object.entries(field.fields).map(([childName, childField]) => [childName, normalizeField(childField, childName)]),
    );
  }

  if (field.type === 'object' && field.variants && typeof field.variants === 'object' && !Array.isArray(field.variants)) {
    normalized.variants = Object.fromEntries(
      Object.entries(field.variants).map(([variantName, variant]) => [variantName, normalizeVariant(variantName, variant, normalized.discriminator)]),
    );
  }

  return normalized;
}

export function inferFieldsFromData(value, kind = 'collection') {
  if (kind === 'collection') {
    const records = Array.isArray(value) ? value : [];
    const names = new Set();
    for (const record of records) {
      if (record && typeof record === 'object' && !Array.isArray(record)) {
        for (const key of Object.keys(record)) {
          names.add(key);
        }
      }
    }

    return Object.fromEntries(
      [...names].sort().map((fieldName) => {
        const samples = records.map((record) => record?.[fieldName]);
        const present = samples.filter((sample) => sample !== undefined && sample !== null);
        const required = records.length > 0 && present.length === records.length;
        return [fieldName, inferFieldFromSamples(present, fieldName, { required })];
      }),
    );
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([fieldName, sample]) => [fieldName, inferFieldFromValue(sample, fieldName, { required: false })]),
  );
}

export function inferFieldFromSamples(samples, fieldName, options = {}) {
  if (samples.length === 0) {
    return { type: 'unknown', required: Boolean(options.required) };
  }

  if (options.inferVariants === true) {
    const variantField = inferDiscriminatedObjectField(samples, options.required);
    if (variantField) {
      return variantField;
    }
  }

  const inferred = samples.map((sample) => inferFieldFromValue(sample, fieldName, options));
  return mergeInferredFields(inferred, options.required);
}

export function inferFieldFromValue(value, fieldName, options = {}) {
  const required = Boolean(options.required);

  if (value === null || value === undefined) {
    return { type: 'unknown', required: false };
  }

  if (Array.isArray(value)) {
    return {
      type: 'array',
      required,
      items: inferFieldFromSamples(value.filter((item) => item !== null && item !== undefined), `${fieldName}Item`, {
        required: false,
        inferVariants: true,
      }),
    };
  }

  if (typeof value === 'object') {
    return {
      type: 'object',
      required,
      fields: inferFieldsFromData(value, 'document'),
    };
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return { type: typeof value, required };
  }

  return { type: 'unknown', required };
}

function mergeInferredFields(fields, required) {
  if (fields.length === 0) {
    return { type: 'unknown', required: Boolean(required) };
  }

  const types = new Set(fields.map((field) => field.type));
  if (types.size > 1) {
    return { type: 'unknown', required: Boolean(required) };
  }

  const [first] = fields;
  if (first.type === 'object') {
    if (fields.every((field) => field.type === 'object' && field.variants && field.discriminator === first.discriminator)) {
      return mergeVariantObjectFields(fields, required);
    }

    const names = new Set();
    for (const field of fields) {
      for (const childName of Object.keys(field.fields ?? {})) {
        names.add(childName);
      }
    }

    return {
      type: 'object',
      required: Boolean(required),
      fields: Object.fromEntries(
        [...names].sort().map((childName) => {
          const childSamples = fields.map((field) => field.fields?.[childName]).filter(Boolean);
          return [childName, mergeInferredFields(childSamples, childSamples.every((field) => field.required))];
        }),
      ),
    };
  }

  if (first.type === 'array') {
    return {
      type: 'array',
      required: Boolean(required),
      items: mergeInferredFields(fields.map((field) => field.items).filter(Boolean), false),
    };
  }

  return {
    ...first,
    required: Boolean(required),
  };
}

function mergeVariantObjectFields(fields, required) {
  const discriminator = fields[0].discriminator;
  const variantNames = new Set();
  for (const field of fields) {
    for (const variantName of Object.keys(field.variants ?? {})) {
      variantNames.add(variantName);
    }
  }

  return {
    type: 'object',
    required: Boolean(required),
    discriminator,
    variants: Object.fromEntries([...variantNames].map((variantName) => [
      variantName,
      mergeVariantDefinitions(fields.map((field) => field.variants?.[variantName]).filter(Boolean), discriminator, variantName),
    ])),
  };
}

function mergeVariantDefinitions(variants, discriminator, variantName) {
  const fieldNames = new Set();
  for (const variant of variants) {
    for (const fieldName of Object.keys(variant.fields ?? {})) {
      fieldNames.add(fieldName);
    }
  }

  const fields = Object.fromEntries([...fieldNames].sort().map((fieldName) => {
    const childFields = variants.map((variant) => variant.fields?.[fieldName]).filter(Boolean);
    const required = childFields.length === variants.length && childFields.every((field) => field.required);
    return [fieldName, mergeInferredFields(childFields, required)];
  }));
  fields[discriminator] = {
    type: 'enum',
    values: [variantName],
    required: true,
  };

  return { fields };
}

function normalizeVariant(variantName, variant, discriminator) {
  const raw = variant && typeof variant === 'object' && !Array.isArray(variant)
    ? variant
    : {};
  const rawFields = raw.fields && typeof raw.fields === 'object' && !Array.isArray(raw.fields)
    ? raw.fields
    : {};
  const normalized = {
    fields: Object.fromEntries(
      Object.entries(rawFields).map(([fieldName, field]) => [fieldName, normalizeField(field, fieldName)]),
    ),
  };

  if ('additionalProperties' in raw) {
    normalized.additionalProperties = Boolean(raw.additionalProperties);
  }

  if (discriminator && !(discriminator in normalized.fields)) {
    normalized.fields = {
      [discriminator]: {
        type: 'enum',
        values: [variantName],
        required: true,
      },
      ...normalized.fields,
    };
  }

  return normalized;
}

function inferDiscriminatedObjectField(samples, required) {
  const records = samples.filter((sample) => sample !== null && sample !== undefined);
  if (records.length === 0 || records.some((sample) => !isPlainRecord(sample))) {
    return null;
  }

  for (const discriminator of ['type', 'kind', 'blockType']) {
    const groups = groupByDiscriminator(records, discriminator);
    if (!groups) {
      continue;
    }

    const signatures = new Set([...groups.values()].map((group) => objectSignature(group[0], discriminator)));
    if (signatures.size < 2) {
      continue;
    }

    return {
      type: 'object',
      required: Boolean(required),
      discriminator,
      variants: Object.fromEntries([...groups.entries()].map(([variantName, group]) => {
        const fields = inferFieldsFromData(group, 'collection');
        fields[discriminator] = {
          type: 'enum',
          values: [variantName],
          required: true,
        };
        return [variantName, {
          fields,
        }];
      })),
    };
  }

  return null;
}

function groupByDiscriminator(records, discriminator) {
  const groups = new Map();
  for (const record of records) {
    const value = record[discriminator];
    if (typeof value !== 'string' || value === '') {
      return null;
    }

    if (!groups.has(value)) {
      groups.set(value, []);
    }
    groups.get(value).push(record);
  }

  return groups.size >= 2 ? groups : null;
}

function objectSignature(record, discriminator) {
  return Object.keys(record)
    .filter((fieldName) => fieldName !== discriminator)
    .sort()
    .join('|');
}

function normalizeRelation(relation, fieldName) {
  return {
    name: String(relation.name ?? relationNameFromField(fieldName)),
    to: relation.to === undefined ? undefined : String(relation.to),
    toField: String(relation.toField ?? 'id'),
    cardinality: relation.cardinality === 'many' ? 'many' : 'one',
  };
}

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function relationNameFromField(fieldName) {
  const withoutId = String(fieldName).replace(/Id$/i, '');
  return withoutId || String(fieldName);
}
