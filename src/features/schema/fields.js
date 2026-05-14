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

  if (field.type === 'object' && field.fields && typeof field.fields === 'object') {
    normalized.fields = Object.fromEntries(
      Object.entries(field.fields).map(([childName, childField]) => [childName, normalizeField(childField, childName)]),
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

function normalizeRelation(relation, fieldName) {
  return {
    name: String(relation.name ?? relationNameFromField(fieldName)),
    to: relation.to === undefined ? undefined : String(relation.to),
    toField: String(relation.toField ?? 'id'),
    cardinality: relation.cardinality === 'many' ? 'many' : 'one',
  };
}

function relationNameFromField(fieldName) {
  const withoutId = String(fieldName).replace(/Id$/i, '');
  return withoutId || String(fieldName);
}
