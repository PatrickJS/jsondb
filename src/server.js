import http from 'node:http';
import { openJsonFixtureDb } from './db.js';
import { handleGraphqlRequest } from './graphql/http.js';
import { handleRestRequest, sendJson } from './rest/handler.js';

export async function startJsonDbServer(options = {}) {
  const db = await openJsonFixtureDb(options);
  const host = options.host ?? db.config.server?.host ?? '127.0.0.1';
  const port = Number(options.port ?? db.config.server?.port ?? 7331);
  const server = http.createServer((request, response) => {
    handleRequest(db, request, response).catch((error) => {
      sendJson(response, 500, {
        error: error.message,
      });
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  return {
    server,
    db,
    url: `http://${host}:${port}`,
  };
}

async function handleRequest(db, request, response) {
  const url = new URL(request.url, 'http://jsondb.local');

  if (db.config.graphql?.enabled !== false && url.pathname === (db.config.graphql?.path ?? '/graphql')) {
    await handleGraphqlRequest(db, request, response);
    return;
  }

  await handleRestRequest(db, request, response, url);
}
