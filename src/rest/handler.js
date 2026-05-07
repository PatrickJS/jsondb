import { makeGeneratedSchema } from '../schema.js';
import { renderJsonDbViewer } from '../web/viewer.js';

export async function handleRestRequest(db, request, response, url = new URL(request.url, 'http://jsondb.local')) {
  if (request.method === 'GET' && url.pathname === '/__jsondb') {
    sendText(response, 200, renderJsonDbViewer({
      graphqlPath: db.config.graphql?.path ?? '/graphql',
    }), 'text/html; charset=utf-8');
    return;
  }

  if (request.method === 'POST' && url.pathname === '/__jsondb/batch') {
    sendJson(response, 200, await executeRestBatch(db, await readJsonBody(request)));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/__jsondb/schema') {
    sendJson(response, 200, makeGeneratedSchema([...db.resources.values()]));
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

  const resource = findResourceByRoute(db, routeName);
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

export function findResourceByRoute(db, routeName) {
  return db.resources.get(routeName)
    ?? [...db.resources.values()].find((candidate) => candidate.routePath.slice(1) === routeName);
}

export async function executeRestBatch(db, body) {
  const requests = Array.isArray(body) ? body : body.requests;
  if (!Array.isArray(requests)) {
    throw new Error('REST batch body must be an array or an object with a requests array');
  }

  const results = [];
  for (const request of requests) {
    results.push(await executeRestBatchItem(db, request));
  }

  return results;
}

export async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString('utf8').trim();
  return text ? JSON.parse(text) : {};
}

export function sendJson(response, status, body) {
  if (status === 204) {
    response.writeHead(status);
    response.end();
    return;
  }

  sendText(response, status, `${JSON.stringify(body, null, 2)}\n`, 'application/json; charset=utf-8');
}

export function sendText(response, status, body, contentType) {
  response.writeHead(status, {
    'content-type': contentType,
  });
  response.end(body);
}

async function executeRestBatchItem(db, item) {
  const method = String(item.method ?? 'GET').toUpperCase();
  const requestPath = String(item.path ?? '/');

  if (!requestPath.startsWith('/')) {
    throw new Error(`REST batch path must start with "/": ${requestPath}`);
  }

  if (requestPath === '/__jsondb/batch') {
    throw new Error('Nested REST batch requests are not supported');
  }

  const response = makeBatchResponse();
  await handleRestRequest(
    db,
    makeBatchRequest(method, item.body),
    response,
    new URL(requestPath, 'http://jsondb.local'),
  );

  return {
    status: response.status,
    headers: response.headers,
    body: response.jsonBody(),
  };
}

function makeBatchRequest(method, body) {
  return {
    method,
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) {
        yield Buffer.from(JSON.stringify(body));
      }
    },
  };
}

function makeBatchResponse() {
  return {
    status: 200,
    headers: {},
    body: '',
    writeHead(status, headers = {}) {
      this.status = status;
      this.headers = headers;
    },
    end(chunk = '') {
      this.body += chunk;
    },
    jsonBody() {
      if (!this.body) {
        return null;
      }

      try {
        return JSON.parse(this.body);
      } catch {
        return this.body;
      }
    },
  };
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
