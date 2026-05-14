export { loadProjectSchema } from './features/schema/project.js';
export { makeGeneratedSchema } from './features/schema/generated.js';
export { inferFieldFromSamples, inferFieldFromValue, inferFieldsFromData, normalizeField } from './features/schema/fields.js';
export { assertRecordMatchesResource, uniqueDuplicateDiagnostic, validateRecordAgainstResource, validateUniqueCollectionFields, validateValueAgainstField } from './features/schema/validation.js';
