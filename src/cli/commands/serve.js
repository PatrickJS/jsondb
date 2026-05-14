import { startJsonDbServer } from '../../server.js';
import { isHelpRequested, valueAfter } from '../args.js';
import { printServeHelp } from '../output.js';

export async function runServe(config, args) {
  if (isHelpRequested(args)) {
    printServeHelp();
    return;
  }

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
