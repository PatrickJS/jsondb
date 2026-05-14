import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { syncJsonFixtureDb, loadConfig } from '../../src/index.js';
import { makeProject, writeConfig } from '../helpers.js';

test('default config adds a small local mock delay range', async () => {
  const cwd = await makeProject();
  const config = await loadConfig({ cwd });

  assert.deepEqual(config.mock.delay, [30, 100]);
});

test('dbDir config changes the fixture source folder', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    dbDir: './jsondb',
  };`);
  await mkdir(path.join(cwd, 'jsondb'), { recursive: true });
  await writeFile(path.join(cwd, 'jsondb/users.json'), `${JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ])}\n`, 'utf8');

  const config = await loadConfig({ cwd });
  const result = await syncJsonFixtureDb(config);
  const metadata = JSON.parse(await readFile(path.join(cwd, '.jsondb/state/.sources.json'), 'utf8'));

  assert.equal(config.dbDir, path.join(cwd, 'jsondb'));
  assert.equal(config.sourceDir, path.join(cwd, 'jsondb'));
  assert.equal(result.schema.resources.users.kind, 'collection');
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, '.jsondb/state/users.json'), 'utf8')), [
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ]);
  assert.equal(metadata.resources.users.path, 'jsondb/users.json');
});

test('config files can use the typed defineConfig helper', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `import { defineConfig } from 'jsondb/config';

export default defineConfig({
  mode: 'mirror',
  mock: {
    delay: [75, 250],
  },
});
`);

  const config = await loadConfig({ cwd });

  assert.equal(config.mode, 'mirror');
  assert.deepEqual(config.mock.delay, [75, 250]);
});
