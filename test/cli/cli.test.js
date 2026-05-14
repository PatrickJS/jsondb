import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { makeProject, writeConfig, writeFixture } from '../helpers.js';

const execFileAsync = promisify(execFile);

test('CLI schema manifest --out writes relative to --cwd', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', email: 'ada@example.com' }]));

  const { stdout } = await execFileAsync(process.execPath, [
    path.resolve('src/cli.js'),
    'schema',
    'manifest',
    '--cwd',
    cwd,
    '--out',
    './src/generated/jsondb.schema.json',
  ]);

  const manifest = JSON.parse(await readFile(path.join(cwd, 'src/generated/jsondb.schema.json'), 'utf8'));

  assert.match(stdout, /Generated src\/generated\/jsondb\.schema\.json/);
  assert.equal(manifest.collections.users.fields.email.ui.component, 'email');
});

test('CLI types --out writes relative to --cwd', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));

  const { stdout } = await execFileAsync(process.execPath, [
    path.resolve('src/cli.js'),
    'types',
    '--cwd',
    cwd,
    '--out',
    './src/generated/jsondb.types.ts',
  ]);

  const generated = await readFile(path.join(cwd, 'src/generated/jsondb.types.ts'), 'utf8');

  assert.match(stdout, /Generated src\/generated\/jsondb\.types\.ts/);
  assert.match(generated, /export type User =/);
});

test('CLI subcommands print focused help without running the command', async () => {
  await assertCliHelp(['schema', '--help'], /Usage:\n  jsondb schema \[resource\]/);
  await assertCliHelp(['types', '--help'], /Usage:\n  jsondb types \[--watch\] \[--out <file>\]/);
  await assertCliHelp(['doctor', '--help'], /Usage:\n  jsondb doctor \[--strict\] \[--json\]/);
  await assertCliHelp(['serve', '--help'], /Usage:\n  jsondb serve \[--host <host>\] \[--port <port>\]/);
  await assertCliHelp(['generate', 'hono', '--help'], /Usage:\n  jsondb generate hono/);
});

test('CLI subcommand help does not load project config', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));
  await writeConfig(cwd, 'throw new Error("broken config should not load for help");');

  await assertCliHelp(['schema', '--help'], /Usage:\n  jsondb schema \[resource\]/, cwd);
  await assertCliHelp(['types', '--help'], /Usage:\n  jsondb types \[--watch\] \[--out <file>\]/, cwd);
  await assertCliHelp(['doctor', '--help'], /Usage:\n  jsondb doctor \[--strict\] \[--json\]/, cwd);
  await assertCliHelp(['serve', '--help'], /Usage:\n  jsondb serve \[--host <host>\] \[--port <port>\]/, cwd);
  await assertCliHelp(['generate', 'hono', '--help'], /Usage:\n  jsondb generate hono/, cwd);
});

async function assertCliHelp(args, pattern, cwd) {
  cwd ??= await makeProject();
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    path.resolve('src/cli.js'),
    ...args,
    '--cwd',
    cwd,
  ], {
    timeout: 1000,
  });

  assert.match(stdout, pattern);
  assert.equal(stderr, '');
}
