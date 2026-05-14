import { loadProjectSchema } from '../../schema.js';
import { forkSourceExists, isValidForkName } from '../config/forks.js';
import { duplicateIdFindings, mixedIdTypeFindings } from './duplicate-ids.js';
import { inconsistentFieldTypeFindings } from './field-consistency.js';
import { relationSuggestionFindings } from './relations.js';
import { schemaGuidanceFindings } from './schema-guidance.js';

export async function runJsonDbDoctor(config) {
  const project = await loadProjectSchema(config);
  const inferredProject = await loadProjectSchema({
    ...config,
    schema: {
      ...config.schema,
      source: 'data',
    },
  });
  const findings = [
    ...project.diagnostics.map((diagnostic) => ({
      source: 'schema',
      ...diagnostic,
      severity: diagnostic.severity ?? 'warn',
    })),
    ...doctorResourceFindings(project.resources),
    ...schemaGuidanceFindings(project, inferredProject),
    ...await doctorForkFindings(config),
  ];

  return {
    summary: summarizeFindings(findings),
    findings,
  };
}

async function doctorForkFindings(config) {
  const findings = [];
  for (const [forkName, forkConfig] of Object.entries(config.forks ?? {})) {
    if (!isValidForkName(forkName)) {
      findings.push({
        code: 'FORK_NAME_INVALID',
        severity: 'error',
        source: 'doctor',
        message: `Invalid jsondb fork name "${forkName}".`,
        hint: 'Use a folder-style name with letters, numbers, underscores, or hyphens, such as "legacy-demo".',
        details: {
          fork: forkName,
        },
      });
      continue;
    }

    if (!await forkSourceExists(forkConfig)) {
      findings.push({
        code: 'FORK_SOURCE_MISSING',
        severity: 'error',
        source: 'doctor',
        message: `jsondb fork "${forkName}" source folder does not exist: ${forkConfig.sourceDir}`,
        hint: `Create db.forks/${forkName}/ or update forks["${forkName}"] in jsondb.config.mjs.`,
        details: {
          fork: forkName,
          sourceDir: forkConfig.sourceDir,
        },
      });
      continue;
    }

    try {
      const project = await loadProjectSchema(forkConfig);
      findings.push(
        ...project.diagnostics.map((diagnostic) => annotateForkFinding(forkName, 'schema', diagnostic)),
        ...doctorResourceFindings(project.resources).map((finding) => annotateForkFinding(forkName, 'doctor', finding)),
      );
    } catch (error) {
      findings.push({
        code: 'FORK_SCHEMA_INVALID',
        severity: 'error',
        source: 'doctor',
        message: `jsondb fork "${forkName}" could not be loaded: ${error.message}`,
        hint: `Fix the fork source files in ${forkConfig.sourceDir}.`,
        details: {
          fork: forkName,
          sourceDir: forkConfig.sourceDir,
        },
      });
    }
  }

  return findings;
}

function annotateForkFinding(forkName, source, finding) {
  return {
    ...finding,
    source,
    message: `Fork "${forkName}": ${finding.message}`,
    details: {
      ...(finding.details ?? {}),
      fork: forkName,
    },
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
