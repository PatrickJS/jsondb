const RELATION_SCALAR_FIELD_TYPES = new Set(['string', 'datetime', 'number', 'boolean', 'enum']);

export function validateProjectRelations(resources) {
  const diagnostics = [];
  const resourceMap = new Map(resources.map((resource) => [resource.name, resource]));

  for (const resource of resources) {
    for (const relation of resource.relations ?? []) {
      const sourceField = resource.fields?.[relation.sourceField] ?? {};
      const sourceFieldDiagnostic = relationSourceFieldDiagnostic(resource, relation, sourceField);
      if (sourceFieldDiagnostic) {
        diagnostics.push(sourceFieldDiagnostic);
      }

      const target = resourceMap.get(relation.targetResource);
      if (!target || target.kind !== 'collection') {
        diagnostics.push({
          code: 'SCHEMA_RELATION_TARGET_RESOURCE_MISSING',
          severity: 'error',
          resource: resource.name,
          field: relation.sourceField,
          message: `${resource.name} relation "${relation.name}" targets missing collection "${relation.targetResource}"`,
          hint: 'Add the target collection fixture or update the relation.to value.',
          details: relation,
        });
        continue;
      }

      if (!(relation.targetField in (target.fields ?? {}))) {
        diagnostics.push({
          code: 'SCHEMA_RELATION_TARGET_FIELD_MISSING',
          severity: 'error',
          resource: resource.name,
          field: relation.sourceField,
          message: `${resource.name} relation "${relation.name}" targets missing field "${relation.targetResource}.${relation.targetField}"`,
          hint: 'Use an existing target field, usually the target collection id field.',
          details: relation,
        });
        continue;
      }

      if (resource.kind !== 'collection') {
        continue;
      }

      if (sourceFieldDiagnostic) {
        continue;
      }

      const targetValues = new Set((Array.isArray(target.seed) ? target.seed : [])
        .map((record) => record?.[relation.targetField])
        .filter((value) => value !== undefined && value !== null && value !== '')
        .map((value) => String(value)));

      for (const [index, record] of resource.seed.entries()) {
        const value = record?.[relation.sourceField];
        if (value === undefined || value === null || value === '') {
          continue;
        }

        if (targetValues.has(String(value))) {
          continue;
        }

        diagnostics.push({
          code: 'SCHEMA_RELATION_TARGET_MISSING',
          severity: sourceField.required ? 'error' : 'warn',
          resource: resource.name,
          field: relation.sourceField,
          message: `${resource.name} seed record ${index} field "${relation.sourceField}" links to missing ${relation.targetResource}.${relation.targetField} "${value}"`,
          hint: `Add a matching ${relation.targetResource} record or update "${relation.sourceField}".`,
          details: {
            ...relation,
            value,
            recordIndex: index,
          },
        });
      }
    }
  }

  return diagnostics;
}

function relationSourceFieldDiagnostic(resource, relation, sourceField) {
  const sourceFieldType = sourceField?.type ?? 'unknown';
  if (RELATION_SCALAR_FIELD_TYPES.has(sourceFieldType)) {
    return null;
  }

  return {
    code: 'SCHEMA_RELATION_SOURCE_FIELD_INVALID',
    severity: 'error',
    resource: resource.name,
    field: relation.sourceField,
    message: `${resource.name} relation "${relation.name}" source field "${relation.sourceField}" must be a scalar field, but found ${sourceFieldType}.`,
    hint: 'Use a scalar id field for to-one relation metadata, such as string, number, boolean, datetime, or enum.',
    details: {
      relation,
      sourceFieldType,
    },
  };
}

export function relationsForResource(resource) {
  if (resource.kind !== 'collection') {
    return [];
  }

  return Object.entries(resource.fields ?? {})
    .filter(([, field]) => field.relation)
    .map(([fieldName, field]) => ({
      name: field.relation.name,
      sourceResource: resource.name,
      sourceField: fieldName,
      targetResource: field.relation.to,
      targetField: field.relation.toField,
      cardinality: field.relation.cardinality,
    }));
}
