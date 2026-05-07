import http from 'node:http';
import { openJsonFixtureDb } from './db.js';

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

  if (request.method === 'GET' && url.pathname === '/__jsondb/schema') {
    const schema = await import('./schema.js').then((module) => module.makeGeneratedSchema([...db.resources.values()]));
    sendJson(response, 200, schema);
    return;
  }

  if (db.config.graphql?.enabled !== false && url.pathname === (db.config.graphql?.path ?? '/graphql')) {
    await handleGraphql(db, request, response);
    return;
  }

  const [routeName, id] = url.pathname.split('/').filter(Boolean);
  if (!routeName) {
    sendJson(response, 200, {
      resources: db.resourceNames(),
      schema: '/__jsondb/schema',
      graphql: db.config.graphql?.path ?? '/graphql',
    });
    return;
  }

  const resource = db.resources.get(routeName)
    ?? [...db.resources.values()].find((candidate) => candidate.routePath.slice(1) === routeName);
  if (!resource) {
    sendJson(response, 404, {
      error: `Unknown resource "${routeName}"`,
    });
    return;
  }

  if (resource.kind === 'collection') {
    await handleCollection(db, resource, id, request, response);
  } else {
    await handleDocument(db, resource, request, response);
  }
}

async function handleCollection(db, resource, id, request, response) {
  const collection = db.collection(resource.name);

  if (request.method === 'GET' && !id) {
    sendJson(response, 200, await collection.all());
    return;
  }

  if (request.method === 'GET' && id) {
    const record = await collection.get(id);
    sendJson(response, record ? 200 : 404, record ?? { error: 'Not found' });
    return;
  }

  if (request.method === 'POST' && !id) {
    sendJson(response, 201, await collection.create(await readJsonBody(request)));
    return;
  }

  if (request.method === 'PATCH' && id) {
    const record = await collection.patch(id, await readJsonBody(request));
    sendJson(response, record ? 200 : 404, record ?? { error: 'Not found' });
    return;
  }

  if (request.method === 'DELETE' && id) {
    const deleted = await collection.delete(id);
    sendJson(response, deleted ? 204 : 404, deleted ? null : { error: 'Not found' });
    return;
  }

  sendJson(response, 405, {
    error: 'Method not allowed',
  });
}

async function handleDocument(db, resource, request, response) {
  const document = db.document(resource.name);

  if (request.method === 'GET') {
    sendJson(response, 200, await document.all());
    return;
  }

  if (request.method === 'PUT') {
    sendJson(response, 200, await document.put(await readJsonBody(request)));
    return;
  }

  if (request.method === 'PATCH') {
    sendJson(response, 200, await document.update(await readJsonBody(request)));
    return;
  }

  sendJson(response, 405, {
    error: 'Method not allowed',
  });
}

async function handleGraphql(db, request, response) {
  const schema = await import('./schema.js').then((module) => module.makeGeneratedSchema([...db.resources.values()]));

  if (request.method === 'GET') {
    sendText(response, 200, schema.graphql, 'text/plain; charset=utf-8');
    return;
  }

  if (request.method === 'POST') {
    sendJson(response, 501, {
      error: 'GraphQL execution is not implemented in the dependency-free server yet.',
      schema: schema.graphql,
    });
    return;
  }

  sendJson(response, 405, {
    error: 'Method not allowed',
  });
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString('utf8').trim();
  return text ? JSON.parse(text) : {};
}

function sendJson(response, status, body) {
  if (status === 204) {
    response.writeHead(status);
    response.end();
    return;
  }

  sendText(response, status, `${JSON.stringify(body, null, 2)}\n`, 'application/json; charset=utf-8');
}

function sendText(response, status, body, contentType) {
  response.writeHead(status, {
    'content-type': contentType,
  });
  response.end(body);
}
