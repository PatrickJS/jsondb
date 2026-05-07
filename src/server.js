import http from 'node:http';
import { watch } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { openJsonFixtureDb } from './db.js';
import { serializeError } from './errors.js';
import { handleGraphqlRequest } from './graphql/http.js';
import { runMockBehavior } from './mock.js';
import { handleRestRequest, sendJson } from './rest/handler.js';
import { syncJsonFixtureDb } from './sync.js';

export async function startJsonDbServer(options = {}) {
  const db = await openJsonFixtureDb({
    ...options,
    allowSourceErrors: true,
  });
  const host = options.host ?? db.config.server?.host ?? '127.0.0.1';
  const port = Number(options.port ?? db.config.server?.port ?? 7331);
  const events = createViewerEventHub();
  let watcher;
  const server = http.createServer((request, response) => {
    handleRequest(db, request, response, events).catch((error) => {
      sendJson(response, error.status ?? 500, serializeError(error, 'SERVER_ERROR'));
    });
  });
  server.once('close', () => {
    watcher?.close();
    events.close();
  });

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, resolve);
    });
    watcher = await watchSourceDir(db, events);
  } catch (error) {
    events.close();
    try {
      server.close();
    } catch {
      // The server may not have reached the listening state.
    }
    throw error;
  }

  const address = server.address();
  const boundPort = address && typeof address === 'object' ? address.port : port;

  return {
    server,
    db,
    url: `http://${host}:${boundPort}`,
  };
}

async function handleRequest(db, request, response, events) {
  const url = new URL(request.url, 'http://jsondb.local');
  if (request.method === 'GET' && url.pathname === '/__jsondb/events') {
    events.subscribe(request, response, db);
    return;
  }

  const mockResult = await runMockBehavior(db.config, url);
  if (mockResult) {
    sendJson(response, mockResult.status, mockResult.body);
    return;
  }

  if (db.config.graphql?.enabled !== false && url.pathname === (db.config.graphql?.path ?? '/graphql')) {
    await handleGraphqlRequest(db, request, response);
    return;
  }

  await handleRestRequest(db, request, response, url);
}

export async function reloadJsonFixtureDb(db) {
  const project = await syncJsonFixtureDb(db.config, { allowErrors: true });
  db.resources = new Map(project.resources.map((resource) => [resource.name, resource]));
  db.diagnostics = project.diagnostics;
  db.schemaVersion = Date.now();
  return project;
}

async function watchSourceDir(db, events) {
  await mkdir(db.config.sourceDir, { recursive: true });

  let timer;
  const watcher = watch(db.config.sourceDir, { recursive: false }, (_event, filename) => {
    if (shouldIgnoreSourceEvent(db, filename)) {
      return;
    }

    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const project = await reloadJsonFixtureDb(db);
        events.publish({
          type: project.diagnostics.some((diagnostic) => diagnostic.severity === 'error') ? 'synced-with-errors' : 'synced',
          version: db.schemaVersion,
          diagnostics: project.diagnostics,
        });
      } catch (error) {
        const diagnostic = {
          code: 'SERVER_SOURCE_RELOAD_FAILED',
          severity: 'error',
          message: error.message,
          hint: 'Fix the source file and jsondb will try to reload it on the next change.',
        };
        db.diagnostics = [diagnostic];
        db.schemaVersion = Date.now();
        events.publish({
          type: 'sync-error',
          version: db.schemaVersion,
          diagnostics: db.diagnostics,
        });
      }
    }, 75);
  });

  return {
    close() {
      clearTimeout(timer);
      watcher.close();
    },
  };
}

function shouldIgnoreSourceEvent(db, filename) {
  if (!filename) {
    return false;
  }

  const relativePath = path.normalize(String(filename));
  if (relativePath === '.jsondb' || relativePath.startsWith(`.jsondb${path.sep}`)) {
    return true;
  }

  const absolutePath = path.join(db.config.sourceDir, relativePath);
  const relativeStatePath = path.relative(db.config.stateDir, absolutePath);
  return relativeStatePath === '' || (!relativeStatePath.startsWith('..') && !path.isAbsolute(relativeStatePath));
}

function createViewerEventHub() {
  const clients = new Set();

  return {
    subscribe(request, response, db) {
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      });
      response.write(': connected\n\n');
      writeViewerEvent(response, {
        type: 'connected',
        version: db.schemaVersion,
        diagnostics: db.diagnostics ?? [],
      });
      clients.add(response);
      request.on('close', () => {
        clients.delete(response);
      });
    },
    publish(payload) {
      for (const response of clients) {
        writeViewerEvent(response, payload);
      }
    },
    close() {
      for (const response of clients) {
        response.end();
      }
      clients.clear();
    },
  };
}

function writeViewerEvent(response, payload) {
  response.write(`event: jsondb\ndata: ${JSON.stringify(payload)}\n\n`);
}
