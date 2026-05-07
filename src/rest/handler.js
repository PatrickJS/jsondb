import { jsonDbError, listChoices, serializeError } from '../errors.js';
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
    const result = await tryRest(async () => executeRestBatch(db, await readJsonBody(request)));
    sendJson(response, result.status, result.body);
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
      error: {
        code: 'REST_UNKNOWN_RESOURCE',
        message: `Unknown REST resource "${routeName}".`,
        hint: `Use one of: ${listChoices([...db.resources.values()].map((resource) => resource.routePath))}.`,
        details: {
          routeName,
          availableRoutes: [...db.resources.values()].map((resource) => resource.routePath),
        },
      },
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
    throw jsonDbError(
      'REST_BATCH_INVALID_BODY',
      'REST batch body must be an array or an object with a requests array.',
      {
        status: 400,
        hint: 'Send POST /__jsondb/batch with [{ "method": "GET", "path": "/users" }].',
        details: {
          receivedType: body === null ? 'null' : Array.isArray(body) ? 'array' : typeof body,
        },
      },
    );
  }

  const results = [];
  for (const [index, request] of requests.entries()) {
    try {
      results.push({
        index,
        ...await executeRestBatchItem(db, request),
      });
    } catch (error) {
      results.push({
        index,
        status: error.status ?? 500,
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
        body: serializeError(error, 'REST_ERROR'),
      });
    }
  }

  return results;
}

export async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString('utf8').trim();
  try {
    return text ? JSON.parse(text) : {};
  } catch (error) {
    throw jsonDbError(
      'REST_INVALID_JSON_BODY',
      'Request body is not valid JSON.',
      {
        status: 400,
        hint: 'Check for trailing commas, unquoted property names, or an incomplete JSON object.',
        details: {
          parserMessage: error.message,
        },
      },
    );
  }
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
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw jsonDbError(
      'REST_BATCH_INVALID_ITEM',
      'Each REST batch item must be an object.',
      {
        status: 400,
        hint: 'Use an item like { "method": "GET", "path": "/users" }.',
      },
    );
  }

  const method = String(item.method ?? 'GET').toUpperCase();
  const requestPath = String(item.path ?? '/');

  if (!requestPath.startsWith('/')) {
    throw jsonDbError(
      'REST_BATCH_INVALID_PATH',
      `REST batch path must start with "/": ${requestPath}`,
      {
        status: 400,
        hint: 'Use absolute local paths such as "/users", "/settings", or "/__jsondb/schema".',
        details: { path: requestPath },
      },
    );
  }

  if (requestPath === '/__jsondb/batch') {
    throw jsonDbError(
      'REST_BATCH_NESTED_UNSUPPORTED',
      'Nested REST batch requests are not supported.',
      {
        status: 400,
        hint: 'Flatten the batch array instead of calling /__jsondb/batch from inside another batch.',
      },
    );
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

async function tryRest(fn) {
  try {
    const body = await fn();
    return {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body,
    };
  } catch (error) {
    return {
      status: error.status ?? 500,
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body: serializeError(error, 'REST_ERROR'),
    };
  }
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
