import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { loadConfig, loadProjectSchema, runJsonDbDoctor } from '../../src/index.js';
import { makeProject, writeConfig, writeFixture } from '../helpers.js';

const execFileAsync = promisify(execFile);

test('doctor suggests likely relations without changing schema shape', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: '1', name: 'Ada Lovelace' },
  ]));
  await writeFixture(cwd, 'todos.json', JSON.stringify([
    { id: 't_1', title: 'Ship prototype', userId: '1' },
  ]));

  const config = await loadConfig({ cwd });
  const result = await runJsonDbDoctor(config);
  const project = await loadProjectSchema(config);
  const suggestion = result.findings.find((finding) => finding.code === 'DOCTOR_RELATION_SUGGESTION');

  assert.equal(suggestion.severity, 'info');
  assert.equal(suggestion.resource, 'todos');
  assert.equal(suggestion.field, 'userId');
  assert.match(suggestion.message, /todos\.userId -> users\.id/);
  assert.deepEqual(suggestion.details.suggestedRelation, {
    name: 'user',
    to: 'users',
    toField: 'id',
    cardinality: 'one',
  });
  assert.deepEqual(project.schema.resources.todos.relations, []);
});

test('doctor does not suggest missing relation targets when every duplicated value is missing', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: 'u_1', name: 'Ada Lovelace' },
  ]));
  await writeFixture(cwd, 'todos.json', JSON.stringify([
    { id: 't_1', title: 'First', userId: 'missing' },
    { id: 't_2', title: 'Second', userId: 'missing' },
  ]));

  const config = await loadConfig({ cwd });
  const result = await runJsonDbDoctor(config);

  assert.equal(result.findings.some((finding) => finding.code === 'DOCTOR_RELATION_MISSING_TARGET_VALUES'), false);
  assert.equal(result.findings.some((finding) => finding.code === 'DOCTOR_RELATION_SUGGESTION'), false);
});

test('doctor reports duplicate ids and inconsistent field types', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'todos.json', JSON.stringify([
    { id: 't_1', title: 'One', done: true },
    { id: 't_1', title: 'Two', done: 'yes' },
    { id: 3, title: 'Three', done: false },
  ]));

  const config = await loadConfig({ cwd });
  const result = await runJsonDbDoctor(config);

  assert.equal(result.summary.warn, 3);
  assert.equal(result.summary.error, 0);
  assert.equal(result.findings.some((finding) => finding.code === 'DOCTOR_DUPLICATE_ID'), true);
  assert.equal(result.findings.some((finding) => finding.code === 'DOCTOR_MIXED_ID_TYPES'), true);
  assert.equal(result.findings.some((finding) => finding.code === 'DOCTOR_INCONSISTENT_FIELD_TYPES' && finding.field === 'done'), true);
});

test('doctor validates configured fork folders', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));
  await writeConfig(cwd, `export default {
    forks: ['legacy-demo', '../unsafe'],
  };`);

  const config = await loadConfig({ cwd });
  const result = await runJsonDbDoctor(config);

  assert.equal(result.summary.error, 2);
  assert.equal(result.findings.some((finding) => finding.code === 'FORK_SOURCE_MISSING' && finding.details?.fork === 'legacy-demo'), true);
  assert.equal(result.findings.some((finding) => finding.code === 'FORK_NAME_INVALID' && finding.details?.fork === '../unsafe'), true);
});

test('doctor CLI supports json output and strict check alias', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'todos.json', JSON.stringify([
    { id: 't_1', done: true },
    { id: 't_1', done: 'yes' },
  ]));

  const { stdout } = await execFileAsync(process.execPath, ['./src/cli.js', 'doctor', '--json', '--cwd', cwd], {
    cwd: path.resolve('.'),
  });
  const result = JSON.parse(stdout);

  assert.equal(result.findings.some((finding) => finding.code === 'DOCTOR_DUPLICATE_ID'), true);
  await assert.rejects(
    () => execFileAsync(process.execPath, ['./src/cli.js', 'check', '--strict', '--cwd', cwd], {
      cwd: path.resolve('.'),
    }),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stdout, /DOCTOR_DUPLICATE_ID/);
      return true;
    },
  );
});
