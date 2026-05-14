import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import path from 'node:path';
import { findExamples, renderExamplesIndex } from '../../scripts/serve-examples.js';
import { loadConfig, syncJsonFixtureDb } from '../../src/index.js';

test('examples launcher can discover repo examples and render an index page', async () => {
  const examples = await findExamples(path.resolve('examples'));
  const names = examples.map((example) => example.name);

  assert.deepEqual(names, [
    'advanced',
    'basic',
    'csv',
    'data-first',
    'diagnostics',
    'relations',
    'rest-client',
    'schema-first',
    'schema-manifest',
  ]);
  assert.equal(examples.find((example) => example.name === 'relations').title, 'Relations');
  assert.deepEqual(examples.find((example) => example.name === 'rest-client').tags, ['client', 'rest', 'batching']);

  const html = renderExamplesIndex(examples.map((example, index) => ({
    ...example,
    port: 7330 + index,
    url: `http://127.0.0.1:${7330 + index}`,
    viewerUrl: `http://127.0.0.1:${7330 + index}/__jsondb`,
  })));

  assert.match(html, /jsondb examples/);
  assert.match(html, /Open viewer/);
  assert.match(html, /advanced/);
  assert.match(html, /csv/);
  assert.match(html, /diagnostics/);
  assert.match(html, /REST Client/);
  assert.match(html, /client/);
  assert.match(html, /relations/);
  assert.match(html, /schema-first/);
  assert.match(html, /Schema Manifest/);
});

test('new onboarding examples sync expected resources', async () => {
  const expected = {
    'rest-client': ['settings', 'users'],
    relations: ['posts', 'users'],
    'schema-manifest': ['projects', 'users'],
  };

  for (const [name, resources] of Object.entries(expected)) {
    const cwd = path.resolve('examples', name);
    const result = await syncJsonFixtureDb(await loadConfig({ cwd }));

    assert.deepEqual(Object.keys(result.schema.resources), resources, `${name} resources`);
  }

  const manifest = JSON.parse(await readFile(path.resolve('examples/schema-manifest/src/generated/jsondb.schema.json'), 'utf8'));
  assert.equal(manifest.collections.projects.fields.status.ui.component, 'segmented-control');
  assert.equal(manifest.collections.users.fields.bio.ui.component, 'markdown');
});
