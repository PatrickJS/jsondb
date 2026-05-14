export function defineConfig(config) {
  return config;
}

export function mergeManifest(base, patch) {
  return mergePlainObjects(structuredClone(base), patch);
}

export function resourceNameFromPath(file, options = {}) {
  const strategy = options.strategy ?? 'basename';
  const parsed = parseFixturePath(file);
  const parts = strategy === 'basename'
    ? [parsed.basename]
    : strategy === 'folder-prefixed'
      ? [...parsed.folders.slice(-1), parsed.basename]
      : [...parsed.folders, parsed.basename];

  return camelCase(parts.filter(Boolean).join('-'));
}

export function parseFixturePath(file) {
  const normalized = String(file).split('\\').join('/');
  const parts = normalized.split('/').filter(Boolean);
  const filename = parts.at(-1) ?? '';
  const extension = fixtureExtension(filename);
  const folders = parts.slice(1, -1);
  const basename = extension ? filename.slice(0, -extension.length) : filename;

  return {
    file: normalized,
    folders,
    folder: folders.at(-1) ?? null,
    filename,
    basename,
    extension,
  };
}

function mergePlainObjects(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return structuredClone(patch);
  }

  const output = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }

    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = mergePlainObjects(output[key], value);
      continue;
    }

    output[key] = structuredClone(value);
  }

  return output;
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function camelCase(value) {
  const words = String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase());

  return words.map((word, index) => (
    index === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`
  )).join('');
}

function fixtureExtension(filename) {
  const schemaMatch = filename.match(/\.schema\.(json|jsonc|mjs)$/i);
  if (schemaMatch) {
    return `.schema.${schemaMatch[1].toLowerCase()}`;
  }

  const dataMatch = filename.match(/\.(json|jsonc|csv)$/i);
  if (dataMatch) {
    return `.${dataMatch[1].toLowerCase()}`;
  }

  const genericMatch = filename.match(/(\.[^./\\]+)$/);
  return genericMatch ? genericMatch[1].toLowerCase() : '';
}
