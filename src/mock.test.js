import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMockDelay, pickDelayMs, runMockBehavior } from './mock.js';

test('mock delay supports range arrays', () => {
  const delay = normalizeMockDelay([50, 300]);

  assert.deepEqual(delay, {
    minMs: 50,
    maxMs: 300,
  });
  assert.equal(pickDelayMs(delay, () => 0), 50);
  assert.equal(pickDelayMs(delay, () => 1), 300);
});

test('mock errors can force chaos responses', async () => {
  const result = await runMockBehavior({
    mock: {
      delay: [0, 0],
      errors: {
        rate: 1,
        status: 599,
        message: 'forced chaos',
      },
    },
  }, new URL('http://jsondb.local/users'));

  assert.deepEqual(result, {
    status: 599,
    body: {
      error: 'forced chaos',
      mock: true,
    },
  });
});
