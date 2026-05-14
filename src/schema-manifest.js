import path from 'node:path';
import { resolveFrom, writeText } from './fs-utils.js';
import { loadProjectSchema } from './schema.js';

export async function generateSchemaManifest(config, options = {}) {
  const project = options.project ?? await loadProjectSchema(config);
  const manifest = renderSchemaManifest(project.resources, config);
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  const outFiles = outputFiles(config, options);

  for (const outFile of outFiles) {
    await writeText(outFile, content);
  }

  return {
    manifest,
    content,
    outFiles,
    diagnostics: project.diagnostics,
  };
}

export function renderSchemaManifest(resources, config = {}) {
  const diagnostics = [];
  const manifest = {
    version: 1,
    collections: {},
    documents: {},
  };

  for (const resource of resources) {
    const bucket = resource.kind === 'document' ? manifest.documents : manifest.collections;
    bucket[resource.name] = resourceManifest(resource, config, diagnostics);
  }

  if (diagnostics.length > 0) {
    throw manifestDiagnosticsError(diagnostics);
  }

  return manifest;
}

function outputFiles(config, options) {
  const outFile = options.outFile
    ? resolveFrom(config.cwd, options.outFile)
    : config.schemaOutFile;
  return outFile ? [outFile] : [];
}

function resourceManifest(resource, config, diagnostics) {
  const manifest = {
    kind: resource.kind,
    name: resource.name,
    fields: renderFieldMap(resource.fields ?? {}, resource, config, diagnostics, ''),
  };

  if (resource.description) {
    manifest.description = resource.description;
  }

  if (resource.kind === 'collection') {
    manifest.idField = resource.idField;
  }

  return manifest;
}

function renderFieldMap(fields, resource, config, diagnostics, parentPath) {
  const output = {};
  for (const [fieldName, field] of Object.entries(fields)) {
    const fieldPath = parentPath ? `${parentPath}.${fieldName}` : fieldName;
    const fieldManifest = renderFieldManifest(fieldName, field, resource, config, diagnostics, fieldPath);
    if (fieldManifest !== null) {
      output[fieldName] = fieldManifest;
    }
  }
  return output;
}

function renderFieldManifest(fieldName, field, resource, config, diagnostics, fieldPath) {
  const defaultManifest = defaultFieldManifest(fieldName, field, resource, config, diagnostics, fieldPath);
  const customizeField = config.schemaManifest?.customizeField;
  const sourceFile = resource.schemaPath ?? resource.dataPath ?? null;

  if (typeof customizeField !== 'function') {
    return defaultManifest;
  }

  let customized;
  try {
    customized = customizeField({
      field,
      fieldName,
      resource,
      resourceName: resource.name,
      path: fieldPath,
      file: sourceFile ? path.relative(config.cwd, sourceFile) : null,
      sourceFile,
      defaultManifest: structuredClone(defaultManifest),
    });
  } catch (error) {
    diagnostics.push({
      code: 'SCHEMA_MANIFEST_FIELD_CUSTOMIZE_FAILED',
      severity: 'error',
      resource: resource.name,
      field: fieldPath,
      message: `Could not customize schema manifest field "${resource.name}.${fieldPath}": ${error.message}`,
      hint: 'Update schemaManifest.customizeField so it returns a JSON-serializable field manifest or null.',
      details: {
        resource: resource.name,
        field: fieldPath,
      },
    });
    return defaultManifest;
  }

  if (customized === null) {
    return null;
  }

  const serializablePath = firstNonSerializablePath(customized);
  if (serializablePath) {
    diagnostics.push(nonSerializableDiagnostic(resource, fieldPath, serializablePath));
    return defaultManifest;
  }

  return customized;
}

function defaultFieldManifest(fieldName, field, resource, config, diagnostics, fieldPath) {
  const manifest = {
    type: field.type ?? 'unknown',
    required: Boolean(field.required),
    nullable: Boolean(field.nullable),
  };

  for (const property of [
    'description',
    'default',
    'values',
    'relation',
    'unique',
    'min',
    'max',
    'minLength',
    'maxLength',
    'pattern',
    'additionalProperties',
  ]) {
    if (property in field) {
      manifest[property] = structuredClone(field[property]);
    }
  }

  if (field.type === 'array') {
    manifest.items = itemManifest(field.items ?? { type: 'unknown' }, resource, config, diagnostics, fieldPath);
  }

  if (field.type === 'object' && field.fields && typeof field.fields === 'object') {
    manifest.fields = renderFieldMap(field.fields, resource, config, diagnostics, fieldPath);
  }

  manifest.ui = inferFieldUi(fieldName, field, resource, fieldPath);
  return manifest;
}

function itemManifest(field, resource, config, diagnostics, fieldPath) {
  const manifest = {
    type: field.type ?? 'unknown',
    required: Boolean(field.required),
    nullable: Boolean(field.nullable),
  };

  for (const property of [
    'description',
    'default',
    'values',
    'relation',
    'unique',
    'min',
    'max',
    'minLength',
    'maxLength',
    'pattern',
    'additionalProperties',
  ]) {
    if (property in field) {
      manifest[property] = structuredClone(field[property]);
    }
  }

  if (field.type === 'array') {
    manifest.items = itemManifest(field.items ?? { type: 'unknown' }, resource, config, diagnostics, fieldPath);
  }

  if (field.type === 'object' && field.fields && typeof field.fields === 'object') {
    manifest.fields = renderFieldMap(field.fields, resource, config, diagnostics, fieldPath);
  }

  return manifest;
}

function inferFieldUi(fieldName, field, resource, fieldPath) {
  const ui = {
    label: labelFromFieldName(fieldName),
    component: componentForField(fieldName, field),
  };

  if (resource.kind === 'collection' && fieldPath === resource.idField) {
    ui.readonly = true;
  }

  if (field.relation?.to) {
    ui.optionsFrom = field.relation.to;
  }

  return ui;
}

function componentForField(fieldName, field) {
  if (field.relation) {
    return 'relationSelect';
  }

  switch (field.type) {
    case 'boolean':
      return 'toggle';
    case 'enum':
      return Array.isArray(field.values) && field.values.length > 0 && field.values.length <= 3
        ? 'radio'
        : 'select';
    case 'datetime':
      return 'datetime';
    case 'number':
      return 'number';
    case 'array':
      return componentForArray(field.items);
    case 'object':
      return field.fields && Object.keys(field.fields).length > 0 ? 'fieldset' : 'json';
    case 'string':
      return componentForString(fieldName, field);
    default:
      return 'json';
  }
}

function componentForArray(itemField = { type: 'unknown' }) {
  if (itemField.type === 'enum') {
    return 'multiSelect';
  }

  if (itemField.type === 'string') {
    return 'tags';
  }

  return 'list';
}

function componentForString(fieldName, field) {
  const normalized = normalizeName(fieldName);

  if (/(^|[^a-z])email([^a-z]|$)/.test(normalized) || normalized.endsWith('email')) {
    return 'email';
  }

  if (/(image|avatar|photo|picture|thumbnail|logo|icon)/.test(normalized)) {
    return 'image';
  }

  if (/(^|[^a-z])(url|uri|website|link)([^a-z]|$)/.test(normalized) || normalized.endsWith('url')) {
    return 'url';
  }

  if (/(description|body|content|notes|note|bio|summary|markdown)/.test(normalized)) {
    return 'textarea';
  }

  if (Number.isFinite(field.maxLength) && field.maxLength >= 240) {
    return 'textarea';
  }

  return 'text';
}

function normalizeName(fieldName) {
  return String(fieldName)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
}

function labelFromFieldName(fieldName) {
  const words = normalizeName(fieldName)
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) {
    return String(fieldName);
  }

  return words.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(' ');
}

function firstNonSerializablePath(value, currentPath = '') {
  if (value === null) {
    return null;
  }

  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'boolean') {
    return null;
  }

  if (valueType === 'number') {
    return Number.isFinite(value) ? null : currentPath || '<root>';
  }

  if (valueType === 'undefined' || valueType === 'function' || valueType === 'symbol' || valueType === 'bigint') {
    return currentPath || '<root>';
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const childPath = firstNonSerializablePath(value[index], `${currentPath}[${index}]`);
      if (childPath) {
        return childPath;
      }
    }
    return null;
  }

  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return currentPath || '<root>';
    }

    for (const [key, childValue] of Object.entries(value)) {
      const childPath = firstNonSerializablePath(childValue, currentPath ? `${currentPath}.${key}` : key);
      if (childPath) {
        return childPath;
      }
    }
  }

  return null;
}

function nonSerializableDiagnostic(resource, fieldPath, serializablePath) {
  return {
    code: 'SCHEMA_MANIFEST_FIELD_NOT_SERIALIZABLE',
    severity: 'error',
    resource: resource.name,
    field: fieldPath,
    message: `schemaManifest.customizeField returned non-serializable output for "${resource.name}.${fieldPath}" at "${serializablePath}".`,
    hint: 'Return JSON-serializable values such as strings, numbers, booleans, arrays, plain objects, null, or return null to omit the field.',
    details: {
      resource: resource.name,
      field: fieldPath,
      path: serializablePath,
    },
  };
}

function manifestDiagnosticsError(diagnostics) {
  const error = new Error(diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
  error.diagnostics = diagnostics;
  return error;
}
