export function applyDefaultsToSeed(seed, resource, config) {
  if (config.defaults?.applyOnSafeMigration === false) {
    return seed;
  }

  if (resource.kind === 'collection') {
    return Array.isArray(seed) ? seed.map((record) => applyDefaultsToRecord(record, resource)) : [];
  }

  return applyDefaultsToRecord(seed, resource);
}

export function applyDefaultsToRecord(record, resource) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return record;
  }

  const next = { ...record };
  for (const [fieldName, field] of Object.entries(resource.fields ?? {})) {
    if (next[fieldName] === undefined && 'default' in field) {
      next[fieldName] = structuredClone(field.default);
    }
  }

  return next;
}
