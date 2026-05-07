import { camelCase, singularResourceName } from '../names.js';
import { describeValue, graphqlError, jsonDbError, listChoices } from '../errors.js';
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
      throw jsonDbError(
        'GRAPHQL_MISSING_QUERY',
        'GraphQL request is missing a query string.',
        {
          hint: 'Pass a raw query string or an object like { query: "{ users { id } }", variables: {} }.',
          details: { receivedType: describeValue(request) },
        },
      );
    }

    const document = parseGraphql(query);
    const data = await executeSelectionSet(db, document.operation, document.selectionSet, variables);
    return { data };
  } catch (error) {
    return {
      data: null,
      errors: [
        graphqlError(error),
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
    throw jsonDbError(
      'GRAPHQL_UNKNOWN_QUERY_FIELD',
      `Unknown GraphQL query field "${selection.name}".`,
      {
        hint: `Use one of: ${listChoices(availableQueryFields(db))}.`,
        details: {
          field: selection.name,
          availableFields: availableQueryFields(db),
        },
      },
    );
  }

  if (resource.kind === 'document') {
    return db.document(resource.name).all();
  }

  if (selection.name === collectionRootName(resource)) {
    return db.collection(resource.name).all();
  }

  const id = readArgument(selection, 'id', variables);
  if (id === undefined || id === null || id === '') {
    throw jsonDbError(
      'GRAPHQL_MISSING_ID_ARGUMENT',
      `GraphQL field "${selection.name}" requires argument "id".`,
      {
        hint: `Use ${selection.name}(id: "example-id") { id } or pass a variable such as ${selection.name}(id: $id).`,
        details: { field: selection.name, argument: 'id' },
      },
    );
  }

  return db.collection(resource.name).get(id);
}

async function executeMutationField(db, selection, variables) {
  const mutation = parseMutationName(db, selection.name);
  if (!mutation) {
    throw jsonDbError(
      'GRAPHQL_UNKNOWN_MUTATION_FIELD',
      `Unknown GraphQL mutation field "${selection.name}".`,
      {
        hint: `Use one of: ${listChoices(availableMutationFields(db))}.`,
        details: {
          field: selection.name,
          availableFields: availableMutationFields(db),
        },
      },
    );
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
      throw argumentTypeError(selection.name, 'input', 'object', input);
    }
    return collection.create(input);
  }

  if (mutation.action === 'update') {
    const id = readArgument(selection, 'id', variables);
    const patch = readArgument(selection, 'patch', variables);
    if (!isObject(patch)) {
      throw argumentTypeError(selection.name, 'patch', 'object', patch);
    }
    return collection.patch(id, patch);
  }

  if (mutation.action === 'delete') {
    const id = readArgument(selection, 'id', variables);
    return collection.delete(id);
  }

  throw jsonDbError('GRAPHQL_UNSUPPORTED_MUTATION', `Unsupported GraphQL collection mutation "${selection.name}".`);
}

async function executeDocumentMutation(db, mutation, selection, variables) {
  const document = db.document(mutation.resource.name);

  if (mutation.action === 'update') {
    const patch = readArgument(selection, 'patch', variables);
    if (!isObject(patch)) {
      throw argumentTypeError(selection.name, 'patch', 'object', patch);
    }
    return document.update(patch);
  }

  if (mutation.action === 'set') {
    const path = readArgument(selection, 'path', variables);
    const value = readArgument(selection, 'value', variables);
    await document.set(path, value);
    return document.all();
  }

  throw jsonDbError('GRAPHQL_UNSUPPORTED_MUTATION', `Unsupported GraphQL document mutation "${selection.name}".`);
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
      if (!(valueNode.name in variables)) {
        throw jsonDbError(
          'GRAPHQL_MISSING_VARIABLE',
          `GraphQL variable "$${valueNode.name}" was referenced but not provided.`,
          {
            hint: `Add "${valueNode.name}" to the variables object for this request.`,
            details: {
              variable: valueNode.name,
              providedVariables: Object.keys(variables),
            },
          },
        );
      }
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

function argumentTypeError(field, argument, expected, actual) {
  return jsonDbError(
    'GRAPHQL_INVALID_ARGUMENT_TYPE',
    `GraphQL mutation "${field}" requires ${expected} argument "${argument}", but received ${describeValue(actual)}.`,
    {
      hint: `Pass ${field}(${argument}: { ... }) or provide a variable whose value is an object.`,
      details: {
        field,
        argument,
        expected,
        received: describeValue(actual),
      },
    },
  );
}

function availableQueryFields(db) {
  return [...db.resources.values()].flatMap((resource) => {
    if (resource.kind === 'document') {
      return [resource.name];
    }

    return [collectionRootName(resource), singleRootName(resource)];
  });
}

function availableMutationFields(db) {
  return [...db.resources.values()].flatMap((resource) => {
    const actions = resource.kind === 'collection'
      ? ['create', 'update', 'delete']
      : ['update', 'set'];
    return actions.map((action) => `${action}${resource.typeName}`);
  });
}
