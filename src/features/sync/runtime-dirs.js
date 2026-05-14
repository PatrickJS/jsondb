import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export async function ensureRuntimeDirs(config) {
  await mkdir(config.stateDir, { recursive: true });
  await mkdir(path.join(config.stateDir, 'state'), { recursive: true });
  await mkdir(path.join(config.stateDir, 'wal'), { recursive: true });
  await mkdir(path.join(config.stateDir, 'migrations'), { recursive: true });
  await mkdir(path.join(config.stateDir, 'types'), { recursive: true });
}
