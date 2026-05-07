import http from 'node:http';
import { openJsonFixtureDb } from './db.js';
import { serializeError } from './errors.js';
import { handleGraphqlRequest } from './graphql/http.js';
import { runMockBehavior } from './mock.js';
import { handleRestRequest, sendJson } from './rest/handler.js';

export async function startJsonDbServer(options = {}) {
  const db = await openJsonFixtureDb(options);
  const host = options.host ?? db.config.server?.host ?? '127.0.0.1';
  const port = Number(options.port ?? db.config.server?.port ?? 7331);
  const server = http.createServer((request, response) => {
    handleRequest(db, request, response).catch((error) => {
      sendJson(response, error.status ?? 500, serializeError(error, 'SERVER_ERROR'));
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  const address = server.address();
  const boundPort = address && typeof address === 'object' ? address.port : port;

  return {
    server,
    db,
    url: `http://${host}:${boundPort}`,
  };
}

async function handleRequest(db, request, response) {
  const url = new URL(request.url, 'http://jsondb.local');
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
