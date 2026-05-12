import { loadProjectSchema } from './schema.js';

export async function runJsonDbDoctor(config) {
  const project = await loadProjectSchema(config);
  const findings = [
    ...project.diagnostics.map((diagnostic) => ({
      source: 'schema',
      ...diagnostic,
      severity: diagnostic.severity ?? 'warn',
    })),
    ...doctorResourceFindings(project.resources),
  ];

  return {
    summary: summarizeFindings(findings),
    findings,
  };
}

function doctorResourceFindings(resources) {
  const collections = resources.filter((resource) => resource.kind === 'collection' && Array.isArray(resource.seed));
  return [
    ...collections.flatMap((resource) => [
      ...duplicateIdFindings(resource),
      ...mixedIdTypeFindings(resource),
      ...inconsistentFieldTypeFindings(resource),
    ]),
    ...relationSuggestionFindings(collections),
  ];
}

function duplicateIdFindings(resource) {
  const seen = new Map();
  const findings = [];

  for (const [index, record] of resource.seed.entries()) {
    const value = record?.[resource.idField];
    if (isEmpty(value)) {
      continue;
    }

    const key = String(value);
    const firstIndex = seen.get(key);
    if (firstIndex !== undefined) {
      findings.push({
        code: 'DOCTOR_DUPLICATE_ID',
        severity: 'warn',
        source: 'doctor',
        resource: resource.name,
        field: resource.idField,
        message: `${resource.name} has duplicate ${resource.idField} "${value}" in records ${firstIndex} and ${index}.`,
        hint: `Make each ${resource.name}.${resource.idField} value unique before relying on update, delete, or relation expansion behavior.`,
        details: {
          idField: resource.idField,
          value,
          firstRecordIndex: firstIndex,
          recordIndex: index,
        },
      });
      continue;
    }

    seen.set(key, index);
  }

  return findings;
}

function mixedIdTypeFindings(resource) {
  const counts = valueTypeCounts(resource.seed.map((record) => record?.[resource.idField]));
  if (counts.size <= 1) {
    return [];
  }

  return [
    {
      code: 'DOCTOR_MIXED_ID_TYPES',
      severity: 'warn',
      source: 'doctor',
      resource: resource.name,
      field: resource.idField,
      message: `${resource.name}.${resource.idField} uses mixed value types: ${describeCounts(counts)}.`,
      hint: 'Use one id type consistently. String ids are usually safest for JSON fixtures.',
      details: {
        idField: resource.idField,
        types: Object.fromEntries(counts),
      },
    },
  ];
}

function inconsistentFieldTypeFindings(resource) {
  const fieldTypes = new Map();

  for (const record of resource.seed) {
    if (!isPlainRecord(record)) {
      continue;
    }

    for (const [fieldName, value] of Object.entries(record)) {
      if (fieldName === resource.idField || isEmpty(value)) {
        continue;
      }

      const counts = fieldTypes.get(fieldName) ?? new Map();
      counts.set(valueKind(value), (counts.get(valueKind(value)) ?? 0) + 1);
      fieldTypes.set(fieldName, counts);
    }
  }

  return [...fieldTypes.entries()]
    .filter(([, counts]) => counts.size > 1)
    .map(([fieldName, counts]) => ({
      code: 'DOCTOR_INCONSISTENT_FIELD_TYPES',
      severity: 'warn',
      source: 'doctor',
      resource: resource.name,
      field: fieldName,
      message: `${resource.name}.${fieldName} has inconsistent value types: ${describeCounts(counts)}.`,
      hint: `Normalize ${resource.name}.${fieldName} values or add a schema if the mixed shape is intentional.`,
      details: {
        types: Object.fromEntries(counts),
      },
    }));
}

function relationSuggestionFindings(collections) {
  const findings = [];

  for (const source of collections) {
    const explicitRelationFields = new Set((source.relations ?? []).map((relation) => relation.sourceField));
    for (const fieldName of Object.keys(source.fields ?? {})) {
      if (fieldName === source.idField || explicitRelationFields.has(fieldName) || !fieldName.endsWith('Id')) {
        continue;
      }

      const relationName = fieldName.slice(0, -2);
      const target = collections.find((candidate) => candidate.name !== source.name && relationNameMatchesResource(relationName, candidate.name));
      if (!target) {
        continue;
      }

      const sourceValues = source.seed
        .map((record) => record?.[fieldName])
        .filter((value) => !isEmpty(value));
      if (sourceValues.length === 0) {
        continue;
      }

      const targetValues = new Set(target.seed
        .map((record) => record?.[target.idField])
        .filter((value) => !isEmpty(value))
        .map((value) => String(value)));
      const matchingValues = sourceValues
        .filter((value) => targetValues.has(String(value)));
      const missingValues = [...new Set(sourceValues
        .filter((value) => !targetValues.has(String(value)))
        .map((value) => String(value)))];
      const matchingCount = matchingValues.length;
      if (matchingCount === 0) {
        continue;
      }

      const suggestedRelation = {
        name: relationName,
        to: target.name,
        toField: target.idField,
        cardinality: 'one',
      };

      if (missingValues.length > 0) {
        findings.push({
          code: 'DOCTOR_RELATION_MISSING_TARGET_VALUES',
          severity: 'warn',
          source: 'doctor',
          resource: source.name,
          field: fieldName,
          message: `${source.name}.${fieldName} looks related to ${target.name}.${target.idField}, but ${missingValues.length} value(s) are missing from ${target.name}.`,
          hint: `Add matching ${target.name} records, fix ${source.name}.${fieldName}, or ignore this if the field is not a relation.`,
          details: {
            suggestedRelation,
            missingValues,
            matchingCount,
          },
        });
        continue;
      }

      findings.push({
        code: 'DOCTOR_RELATION_SUGGESTION',
        severity: 'info',
        source: 'doctor',
        resource: source.name,
        field: fieldName,
        message: `Possible relation detected: ${source.name}.${fieldName} -> ${target.name}.${target.idField}.`,
        hint: `Add relation metadata to ${source.name}.schema.json to enable ?expand=${relationName}.`,
        details: {
          suggestedRelation,
          matchingCount,
        },
      });
    }
  }

  return findings;
}

function relationNameMatchesResource(relationName, resourceName) {
  const normalizedRelation = relationName.toLowerCase();
  return resourceNameVariants(resourceName).has(normalizedRelation);
}

function resourceNameVariants(resourceName) {
  const normalized = resourceName.toLowerCase();
  const variants = new Set([normalized]);
  if (normalized.endsWith('ies') && normalized.length > 3) {
    variants.add(`${normalized.slice(0, -3)}y`);
  }
  if (normalized.endsWith('s') && normalized.length > 1) {
    variants.add(normalized.slice(0, -1));
  }
  return variants;
}

function valueTypeCounts(values) {
  const counts = new Map();
  for (const value of values) {
    if (isEmpty(value)) {
      continue;
    }

    const kind = valueKind(value);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return counts;
}

function valueKind(value) {
  if (Array.isArray(value)) {
    return 'array';
  }
  if (value === null) {
    return 'null';
  }
  return typeof value;
}

function describeCounts(counts) {
  return [...counts.entries()].map(([kind, count]) => `${kind} (${count})`).join(', ');
}

function summarizeFindings(findings) {
  return findings.reduce((summary, finding) => {
    summary[finding.severity] = (summary[finding.severity] ?? 0) + 1;
    return summary;
  }, {
    error: 0,
    warn: 0,
    info: 0,
  });
}

function isPlainRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function isEmpty(value) {
  return value === undefined || value === null || value === '';
}
