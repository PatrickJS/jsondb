export function makeGeneratedSchema(resources, diagnostics = []) {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    resources: Object.fromEntries(resources.map((resource) => [resource.name, serializeResource(resource)])),
    relations: resources.flatMap((resource) => resource.relations ?? []),
    rest: Object.fromEntries(resources.map((resource) => [resource.name, restRoutes(resource)])),
    graphql: generateGraphqlSdl(resources),
    diagnostics,
  };
}

function serializeResource(resource) {
  return {
    kind: resource.kind,
    typeName: resource.typeName,
    routePath: resource.routePath,
    idField: resource.kind === 'collection' ? resource.idField : undefined,
    description: resource.description,
    fields: resource.fields,
    relations: resource.relations,
    seed: resource.seed,
    source: {
      typeSource: resource.typeSource,
      dataPath: resource.dataPath,
      dataFormat: resource.dataFormat,
      dataHash: resource.dataHash,
      schemaPath: resource.schemaPath,
      generatedIds: resource.generatedIds,
    },
  };
}

function restRoutes(resource) {
  if (resource.kind === 'document') {
    return [
      `GET ${resource.routePath}`,
      `PUT ${resource.routePath}`,
      `PATCH ${resource.routePath}`,
    ];
  }

  return [
    `GET ${resource.routePath}`,
    `GET ${resource.routePath}/:${resource.idField}`,
    `POST ${resource.routePath}`,
    `PATCH ${resource.routePath}/:${resource.idField}`,
    `DELETE ${resource.routePath}/:${resource.idField}`,
  ];
}

function generateGraphqlSdl(resources) {
  const lines = ['scalar JSON', ''];

  for (const resource of resources) {
    lines.push(...graphqlType(resource), '');
  }

  return lines.join('\n').trimEnd();
}

function graphqlType(resource) {
  const lines = [`type ${resource.typeName} {`];
  for (const [fieldName, field] of Object.entries(resource.fields)) {
    if (field.description) {
      lines.push(`  "${field.description.replaceAll('"', '\\"')}"`);
    }
    lines.push(`  ${fieldName}: ${graphqlFieldType(field, fieldName === resource.idField)}`);
  }
  lines.push('}');
  return lines;
}

function graphqlFieldType(field, isIdField = false) {
  if (isIdField) {
    return field.required ? 'ID!' : 'ID';
  }

  const suffix = field.required ? '!' : '';
  switch (field.type) {
    case 'string':
    case 'datetime':
    case 'enum':
      return `String${suffix}`;
    case 'number':
      return `Float${suffix}`;
    case 'boolean':
      return `Boolean${suffix}`;
    case 'array':
      return `[JSON]${suffix}`;
    case 'object':
    case 'unknown':
    default:
      return `JSON${suffix}`;
  }
}
