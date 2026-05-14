export function parseGlobalOptions(args) {
  return {
    cwd: valueAfter(args, '--cwd') ?? process.cwd(),
    configPath: valueAfter(args, '--config'),
  };
}

export function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

export function isHelpRequested(args) {
  return args.includes('--help') || args.includes('-h');
}
