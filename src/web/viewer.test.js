import assert from 'node:assert/strict';
import test from 'node:test';
import { renderJsonDbViewer } from './viewer.js';

test('web viewer renders the jsondb tool surface', () => {
  const html = renderJsonDbViewer({ graphqlPath: '/graphql' });

  assert.match(html, /jsondb viewer/);
  assert.match(html, /cdn\.tailwindcss\.com/);
  assert.match(html, /htmx\.org/);
  assert.match(html, /Data/);
  assert.match(html, /REST Specs/);
  assert.match(html, /GraphQL Examples/);
  assert.match(html, /REST Runner/);
  assert.match(html, /GraphQL Runner/);
  assert.match(html, /Generated Schema/);
  assert.match(html, /\/__jsondb\/schema/);
});
