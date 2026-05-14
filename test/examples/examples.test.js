import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { findExamples, renderExamplesIndex } from '../../scripts/serve-examples.js';

test('examples launcher can discover repo examples and render an index page', async () => {
  const examples = await findExamples(path.resolve('examples'));
  const names = examples.map((example) => example.name);

  assert.deepEqual(names, ['advanced', 'basic', 'csv', 'data-first', 'diagnostics', 'schema-first']);

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
  assert.match(html, /schema-first/);
});
