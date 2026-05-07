#!/usr/bin/env node
import http from 'node:http';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { startJsonDbServer } from '../src/server.js';

const root = process.cwd();
const options = parseArgs(process.argv.slice(2));

if (import.meta.url === `file://${process.argv[1]}`) {
  serveExamples(options).catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

export async function serveExamples(options = {}) {
  const host = options.host ?? '127.0.0.1';
  const indexPort = Number(options.port ?? 7329);
  const firstExamplePort = Number(options.firstExamplePort ?? indexPort + 1);
  const examples = await findExamples(path.join(root, 'examples'));

  if (examples.length === 0) {
    throw new Error('No examples found.');
  }

  const running = [];
  for (const [index, example] of examples.entries()) {
    const port = firstExamplePort + index;
    const app = await startJsonDbServer({
      cwd: example.cwd,
      port,
      host,
    });
    running.push({
      ...example,
      port,
      url: app.url,
      viewerUrl: `${app.url}/__jsondb`,
      server: app.server,
    });
  }

  const indexServer = http.createServer((request, response) => {
    if (request.url === '/examples.json') {
      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
      });
      response.end(`${JSON.stringify(running.map(publicExample), null, 2)}\n`);
      return;
    }

    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
    });
    response.end(renderExamplesIndex(running));
  });

  await new Promise((resolve, reject) => {
    indexServer.once('error', reject);
    indexServer.listen(indexPort, host, resolve);
  });

  console.log(`jsondb examples index: http://${host}:${indexPort}`);
  for (const example of running) {
    console.log(`${example.name.padEnd(14)} ${example.viewerUrl}`);
  }
  console.log('Press Ctrl+C to stop.');

  return {
    indexUrl: `http://${host}:${indexPort}`,
    indexServer,
    examples: running,
  };
}

export async function findExamples(examplesDir) {
  const entries = await readdir(examplesDir, { withFileTypes: true });
  const examples = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const cwd = path.join(examplesDir, entry.name);
    examples.push({
      name: entry.name,
      cwd,
      relativePath: path.relative(root, cwd),
    });
  }

  return examples.sort((left, right) => left.name.localeCompare(right.name));
}

export function renderExamplesIndex(examples) {
  const rows = examples.map((example) => `
        <article class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h2 class="text-base font-semibold text-slate-950">${escapeHtml(example.name)}</h2>
              <p class="mt-1 text-sm text-slate-600">${escapeHtml(example.relativePath)}</p>
            </div>
            <span class="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">:${example.port}</span>
          </div>
          <div class="mt-4 flex flex-wrap gap-2">
            <a class="rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800" href="${example.viewerUrl}">Open viewer</a>
            <a class="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-emerald-700" href="${example.url}/__jsondb/schema">Schema JSON</a>
            <a class="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-emerald-700" href="${example.url}/graphql">GraphQL SDL</a>
          </div>
        </article>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>jsondb examples</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
</head>
<body class="bg-slate-50 text-slate-950">
  <main class="mx-auto max-w-5xl px-5 py-8">
    <header class="mb-6">
      <h1 class="text-2xl font-bold tracking-normal">jsondb examples</h1>
      <p class="mt-2 text-sm text-slate-600">Each example runs its own jsondb server. Open a viewer to inspect data, REST routes, GraphQL examples, and mutations.</p>
    </header>
    <section class="grid gap-4 sm:grid-cols-2">
${rows}
    </section>
  </main>
</body>
</html>`;
}

function publicExample(example) {
  return {
    name: example.name,
    relativePath: example.relativePath,
    url: example.url,
    viewerUrl: example.viewerUrl,
    port: example.port,
  };
}

function parseArgs(args) {
  return {
    host: valueAfter(args, '--host'),
    port: valueAfter(args, '--port'),
    firstExamplePort: valueAfter(args, '--first-example-port'),
  };
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
