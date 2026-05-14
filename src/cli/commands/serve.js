import { startJsonDbServer } from '../../server.js';
import { valueAfter } from '../args.js';

export async function runServe(config, args) {
  const host = valueAfter(args, '--host') ?? config.server.host;
  const port = valueAfter(args, '--port') ?? config.server.port;
  const { url } = await startJsonDbServer({
    ...config,
    host,
    port,
  });
  console.log(`jsondb server listening at ${url}`);
  return new Promise(() => {});
}
