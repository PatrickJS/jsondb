export function generatedSchemaMetadata(resources, diagnostics, contributors = defaultGeneratedSchemaMetadataContributors()) {
  return Object.assign(
    {},
    ...contributors.map((contributor) => contributor({ resources, diagnostics }) ?? {}),
  );
}

export function defaultGeneratedSchemaMetadataContributors() {
  return [
    restSchemaMetadata,
    graphqlSchemaMetadata,
  ];
}

export function restSchemaMetadata({ resources }) {
  return {
    rest: Object.fromEntries(resources.map((resource) => [resource.name, restRoutes(resource)])),
  };
}

export function graphqlSchemaMetadata({ resources }) {
  return {
    graphql: generateGraphqlSdl(resources),
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
