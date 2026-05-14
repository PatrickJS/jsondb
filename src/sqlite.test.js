import assert from 'node:assert/strict';
import test from 'node:test';
import { makeProject, writeFixture } from '../test/helpers.js';
import { openSqliteJsonDb } from './sqlite.js';

test('SQLite adapter supports collection and document CRUD when node:sqlite is available', async (t) => {
  try {
    await import('node:sqlite');
  } catch {
    t.skip('node:sqlite is not available in this Node.js runtime');
    return;
  }

  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true },
      "role": {
        "type": "enum",
        "values": ["admin", "user"],
        "default": "user"
      },
      "active": {
        "type": "boolean",
        "default": true
      },
      "profile": {
        "type": "object"
      }
    },
    "seed": []
  }`);
  await writeFixture(cwd, 'chart-mappings.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true }
    },
    "seed": []
  }`);
  await writeFixture(cwd, 'settings.schema.jsonc', `{
    "kind": "document",
    "fields": {
      "theme": {
        "type": "string",
        "default": "light"
      }
    },
    "seed": {}
  }`);

  const db = await openSqliteJsonDb({
    cwd,
    file: ':memory:',
  });

  try {
    const created = await db.collection('users').create({
      name: 'Ada Lovelace',
      profile: {
        title: 'Mathematician',
      },
    });
    assert.deepEqual(created, {
      id: '1',
      name: 'Ada Lovelace',
      role: 'user',
      active: true,
      profile: {
        title: 'Mathematician',
      },
    });

    assert.deepEqual(await db.collection('users').get('1'), created);
    assert.equal(await db.collection('users').exists('1'), true);
    assert.equal(await db.collection('users').exists('missing'), false);
    assert.deepEqual(await db.collection('chart-mappings').create({
      id: 'mapping_1',
      name: 'Default',
    }), {
      id: 'mapping_1',
      name: 'Default',
    });
    assert.equal((await db.collection('chartMappings').get('mapping_1')).name, 'Default');

    await assert.rejects(
      () => db.collection('users').create({
        name: 'Grace Hopper',
        role: 'owner',
      }),
      /expected one of/,
    );

    assert.deepEqual(await db.document('settings').put({}), {
      theme: 'light',
    });
    assert.equal((await db.document('settings').all()).theme, 'light');
  } finally {
    db.close();
  }
});
