import type { JsonDbOptions } from './index.d.ts';

/**
 * jsondb project configuration.
 *
 * Use with `// @ts-check` in `jsondb.config.mjs` for editor autocomplete:
 *
 * ```js
 * import { defineConfig } from 'jsondb/config';
 *
 * export default defineConfig({
 *   dbDir: './db',
 * });
 * ```
 */
export type JsonDbConfig = JsonDbOptions;

/**
 * Type-only helper for authoring `jsondb.config.mjs`.
 *
 * It returns the config unchanged at runtime and exists so JavaScript config
 * files get autocomplete, literal value checking, and inline JSDoc.
 */
export function defineConfig<Config extends JsonDbConfig>(config: Config): Config;
