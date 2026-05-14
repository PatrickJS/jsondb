import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function readText(filePath) {
  return readFile(filePath, 'utf8');
}

export async function writeText(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
}

export function resolveFrom(baseDir, maybeRelative) {
  if (path.isAbsolute(maybeRelative)) {
    return maybeRelative;
  }

  return path.resolve(baseDir, maybeRelative);
}

export function toPosixPath(value) {
  return value.split(path.sep).join('/');
}
