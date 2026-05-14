import path from 'node:path';
import { generateHonoStarter } from '../../generate/hono.js';
import { valueAfter } from '../args.js';

export async function runGenerate(config, args) {
  const target = args[0];
  if (target !== 'hono') {
    throw new Error('Usage: jsondb generate hono [--out <dir>] [--api <rest|graphql|rest,graphql|none>] [--db sqlite] [--app <standalone|module>] [--seed fixtures] [--allow-warnings]');
  }

  const result = await generateHonoStarter(config, {
    outDir: valueAfter(args, '--out'),
    api: valueAfter(args, '--api'),
    db: valueAfter(args, '--db'),
    app: valueAfter(args, '--app'),
    seed: valueAfter(args, '--seed'),
    allowWarnings: args.includes('--allow-warnings') ? true : undefined,
  });

  for (const filePath of result.files) {
    console.log(`Generated ${path.relative(config.cwd, filePath)}`);
  }
}
