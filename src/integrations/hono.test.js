import assert from 'node:assert/strict';
import test from 'node:test';
import { jsonDbContext } from './hono.js';
import { makeProject, writeFixture } from '../../test/helpers.js';

test('jsonDbContext reuses the opened db when created from options', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));
  const middleware = jsonDbContext({ cwd });
  const first = fakeContext();
  const second = fakeContext();
  let nextCalls = 0;

  await middleware(first, async () => {
    nextCalls += 1;
  });
  await middleware(second, async () => {
    nextCalls += 1;
  });

  assert.equal(nextCalls, 2);
  assert.equal(first.get('jsondb'), second.get('jsondb'));
});

function fakeContext() {
  const values = new Map();
  return {
    set(key, value) {
      values.set(key, value);
    },
    get(key) {
      return values.get(key);
    },
  };
}
