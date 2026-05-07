import { camelCase, singularResourceName } from '../names.js';
import { parseGraphql } from './parser.js';

export async function executeGraphql(db, request) {
  if (Array.isArray(request)) {
    return executeGraphqlBatch(db, request);
  }

  return executeGraphqlSingle(db, request);
}

export async function executeGraphqlBatch(db, requests) {
  const results = [];

  for (const request of requests) {
    results.push(await executeGraphqlSingle(db, request));
  }

  return results;
}

async function executeGraphqlSingle(db, request) {
  try {
    const query = typeof request === 'string' ? request : request.query;
    const variables = typeof request === 'string' ? {} : request.variables ?? {};

    if (!query || typeof query !== 'string') {
      throw new Error('GraphQL request must include a query string');
    }

    const document = parseGraphql(query);
    const data = await executeSelectionSet(db, document.operation, document.selectionSet, variables);
    return { data };
  } catch (error) {
    return {
      data: null,
      errors: [
        {
          message: error.message,
        },
      ],
    };
  }
}

async function executeSelectionSet(db, operation, selections, variables) {
  const data = {};

  for (const selection of selections) {
    const key = responseKey(selection);
    const value = operation === 'mutation'
      ? await executeMutationField(db, selection, variables)
      : await executeQueryField(db, selection, variables);
    data[key] = projectValue(value, selection.selectionSet);
  }

  return data;
}

async function executeQueryField(db, selection, variables) {
  const resource = findQueryResource(db, selection.name);
  if (!resource) {
    throw new Error(`Unknown GraphQL query field "${selection.name}"`);
  }

  if (resource.kind === 'document') {
    return db.document(resource.name).all();
  }

  if (selection.name === collectionRootName(resource)) {
    return db.collection(resource.name).all();
  }

  const id = readArgument(selection, 'id', variables);
  if (id === undefined || id === null || id === '') {
    throw new Error(`GraphQL field "${selection.name}" requires argument "id"`);
  }

  return db.collection(resource.name).get(id);
}

async function executeMutationField(db, selection, variables) {
  const mutation = parseMutationName(db, selection.name);
  if (!mutation) {
    throw new Error(`Unknown GraphQL mutation field "${selection.name}"`);
  }

  if (mutation.resource.kind === 'collection') {
    return executeCollectionMutation(db, mutation, selection, variables);
  }

  return executeDocumentMutation(db, mutation, selection, variables);
}

async function executeCollectionMutation(db, mutation, selection, variables) {
  const collection = db.collection(mutation.resource.name);

  if (mutation.action === 'create') {
    const input = readArgument(selection, 'input', variables);
    if (!isObject(input)) {
      throw new Error(`GraphQL mutation "${selection.name}" requires object argument "input"`);
    }
    return collection.create(input);
  }

  if (mutation.action === 'update') {
    const id = readArgument(selection, 'id', variables);
    const patch = readArgument(selection, 'patch', variables);
    if (!isObject(patch)) {
      throw new Error(`GraphQL mutation "${selection.name}" requires object argument "patch"`);
    }
    return collection.patch(id, patch);
  }

  if (mutation.action === 'delete') {
    const id = readArgument(selection, 'id', variables);
    return collection.delete(id);
  }

  throw new Error(`Unsupported GraphQL collection mutation "${selection.name}"`);
}

async function executeDocumentMutation(db, mutation, selection, variables) {
  const document = db.document(mutation.resource.name);

  if (mutation.action === 'update') {
    const patch = readArgument(selection, 'patch', variables);
    if (!isObject(patch)) {
      throw new Error(`GraphQL mutation "${selection.name}" requires object argument "patch"`);
    }
    return document.update(patch);
  }

  if (mutation.action === 'set') {
    const path = readArgument(selection, 'path', variables);
    const value = readArgument(selection, 'value', variables);
    await document.set(path, value);
    return document.all();
  }

  throw new Error(`Unsupported GraphQL document mutation "${selection.name}"`);
}

function findQueryResource(db, fieldName) {
  return [...db.resources.values()].find((resource) => {
    if (resource.kind === 'document') {
      return resource.name === fieldName;
    }

    return collectionRootName(resource) === fieldName || singleRootName(resource) === fieldName;
  });
}

function parseMutationName(db, fieldName) {
  for (const resource of db.resources.values()) {
    const typeName = resource.typeName;
    for (const action of mutationActions(resource)) {
      if (fieldName === `${action}${typeName}`) {
        return { action, resource };
      }
    }
  }

  return null;
}

function mutationActions(resource) {
  return resource.kind === 'collection'
    ? ['create', 'update', 'delete']
    : ['update', 'set'];
}

function projectValue(value, selectionSet) {
  if (!selectionSet || value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => projectValue(item, selectionSet));
  }

  if (!isObject(value)) {
    return value;
  }

  const projected = {};
  for (const selection of selectionSet) {
    projected[responseKey(selection)] = projectValue(value[selection.name], selection.selectionSet);
  }

  return projected;
}

function readArgument(selection, name, variables) {
  if (!(name in selection.arguments)) {
    return undefined;
  }

  return evaluateValue(selection.arguments[name], variables);
}

function evaluateValue(valueNode, variables) {
  switch (valueNode.kind) {
    case 'variable':
      return variables[valueNode.name];
    case 'list':
      return valueNode.values.map((value) => evaluateValue(value, variables));
    case 'object':
      return Object.fromEntries(
        Object.entries(valueNode.fields).map(([name, value]) => [name, evaluateValue(value, variables)]),
      );
    case 'literal':
    default:
      return valueNode.value;
  }
}

function collectionRootName(resource) {
  return resource.name;
}

function singleRootName(resource) {
  return camelCase(singularResourceName(resource.name));
}

function responseKey(selection) {
  return selection.alias ?? selection.name;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
