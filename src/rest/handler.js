import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseCsvRecords } from '../csv.js';
import { jsonDbError, listChoices, serializeError } from '../errors.js';
import { makeGeneratedSchema } from '../schema.js';
import { syncJsonFixtureDb } from '../sync.js';
import { renderJsonDbViewer } from '../web/viewer.js';
import { shapeCollectionRead } from './shape.js';

export async function handleRestRequest(db, request, response, url = new URL(request.url, 'http://jsondb.local'), options = {}) {
  try {
    await handleRestRequestUnsafe(db, request, response, url, options);
  } catch (error) {
    sendJson(response, error.status ?? 500, serializeError(error, 'REST_ERROR'));
  }
}

async function handleRestRequestUnsafe(db, request, response, url, options) {
  const routeOptions = normalizeRestRouteOptions(db, options);

  if (request.method === 'GET' && url.pathname === routeOptions.viewerPath) {
    sendText(response, 200, renderJsonDbViewer({
      graphqlPath: routeOptions.graphqlPath,
      schemaPath: routeOptions.schemaPath,
      eventsPath: routeOptions.eventsPath,
      importPath: routeOptions.importPath,
      restBatchPath: routeOptions.batchPath,
      restBasePath: routeOptions.restBasePath,
      sourceDirLabel: sourceDirLabel(db.config),
    }), 'text/html; charset=utf-8');
    return;
  }

  if (request.method === 'POST' && url.pathname === routeOptions.batchPath) {
    const result = await tryRest(async () => executeRestBatch(db, await readJsonBody(request, {
      maxBytes: maxBodyBytes(db),
    }), routeOptions));
    sendJson(response, result.status, result.body);
    return;
  }

  if (request.method === 'POST' && url.pathname === routeOptions.importPath) {
    sendJson(response, 201, await importCsvFixture(db, request, routeOptions));
    return;
  }

  if (request.method === 'GET' && url.pathname === routeOptions.schemaPath) {
    sendJson(response, 200, makeGeneratedSchema([...db.resources.values()], db.diagnostics ?? []));
    return;
  }

  const resourceUrl = restResourceUrl(url, routeOptions);
  const [routeName, id] = resourceUrl.pathname.split('/').filter(Boolean);
  if (!routeName) {
    const discovery = rootDiscovery(db, routeOptions);
    if (request.method === 'GET' && requestPrefersHtml(request)) {
      sendText(response, 200, renderRootDiscovery(discovery), 'text/html; charset=utf-8');
      return;
    }

    sendJson(response, 200, discovery);
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
    await handleCollection(db, resource, id, request, response, resourceUrl);
  } else {
    await handleDocument(db, resource, request, response);
  }
}

export function findResourceByRoute(db, routeName) {
  return db.resources.get(routeName)
    ?? [...db.resources.values()].find((candidate) => candidate.routePath.slice(1) === routeName);
}

export async function executeRestBatch(db, body, options = {}) {
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
        ...await executeRestBatchItem(db, request, options),
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

export async function readRawBody(request, options = {}) {
  const chunks = [];
  const maxBytes = Number(options.maxBytes ?? Infinity);
  let byteLength = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    byteLength += buffer.length;
    if (byteLength > maxBytes) {
      throw jsonDbError(
        'JSON_BODY_TOO_LARGE',
        `Request body is too large. Received more than ${maxBytes} bytes.`,
        {
          status: 413,
          hint: 'Send a smaller JSON payload or increase server.maxBodyBytes in jsondb.config.mjs for local development.',
          details: {
            maxBodyBytes: maxBytes,
          },
        },
      );
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

export async function readJsonBody(request, options = {}) {
  const text = (await readRawBody(request, options)).toString('utf8').trim();
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

function maxBodyBytes(db) {
  return Number(db.config.server?.maxBodyBytes ?? 1048576);
}

function normalizeRestRouteOptions(db, options = {}) {
  const apiBase = normalizeBasePath(options.apiBase ?? '/__jsondb');
  return {
    apiBase,
    viewerPath: options.viewerPath ?? apiBase,
    schemaPath: options.schemaPath ?? `${apiBase}/schema`,
    batchPath: options.batchPath ?? `${apiBase}/batch`,
    importPath: options.importPath ?? `${apiBase}/import`,
    eventsPath: options.eventsPath ?? `${apiBase}/events`,
    graphqlPath: options.graphqlPath ?? db.config.graphql?.path ?? '/graphql',
    restBasePath: options.restBasePath ?? '',
  };
}

function restResourceUrl(url, options) {
  if (!options.restBasePath || !pathStartsWith(url.pathname, options.restBasePath)) {
    return url;
  }

  const next = new URL(url.href);
  const stripped = next.pathname.slice(options.restBasePath.length);
  next.pathname = stripped.startsWith('/') ? stripped : `/${stripped}`;
  return next;
}

function pathStartsWith(pathname, basePath) {
  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

function normalizeBasePath(value) {
  const pathValue = `/${String(value ?? '').replace(/^\/+/, '').replace(/\/+$/, '')}`;
  return pathValue === '/' ? '' : pathValue;
}

function sourceDirLabel(config) {
  const relative = path.relative(config.cwd, config.sourceDir) || '.';
  return `${relative.split(path.sep).join('/')}/`;
}

function rootDiscovery(db, options = {}) {
  const schemaPath = options.schemaPath ?? '/__jsondb/schema';
  const viewerPath = options.viewerPath ?? '/__jsondb';
  const graphqlPath = options.graphqlPath ?? db.config.graphql?.path ?? '/graphql';

  return {
    resources: db.resourceNames(),
    viewer: viewerPath,
    schema: schemaPath,
    graphql: graphqlPath,
    links: {
      viewer: viewerPath,
      schema: schemaPath,
      graphql: graphqlPath,
      resources: Object.fromEntries([...db.resources.values()].map((resource) => [resource.name, joinPaths(options.restBasePath ?? '', resource.routePath)])),
    },
  };
}

function joinPaths(basePath, routePath) {
  if (!basePath) {
    return routePath;
  }

  const base = `/${String(basePath).replace(/^\/+/, '').replace(/\/+$/, '')}`;
  const route = `/${String(routePath || '/').replace(/^\/+/, '')}`;
  return `${base}${route === '/' ? '' : route}`;
}

function requestPrefersHtml(request) {
  const accept = headerValue(request, 'accept');
  if (!accept) {
    return false;
  }

  const preferences = parseAcceptHeader(accept);
  const html = acceptedMediaScore(preferences, 'text/html');
  const json = acceptedMediaScore(preferences, 'application/json');
  return compareAcceptScores(html, json) > 0;
}

function parseAcceptHeader(value) {
  return String(value).split(',').map((entry, index) => {
    const [mediaRange, ...parameters] = entry.trim().split(';');
    let quality = 1;
    for (const parameter of parameters) {
      const [name, rawValue] = parameter.trim().split('=');
      if (name?.toLowerCase() === 'q') {
        const parsed = Number(rawValue);
        quality = Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0;
      }
    }

    return {
      index,
      mediaRange: mediaRange.toLowerCase(),
      quality,
    };
  }).filter((preference) => preference.mediaRange.includes('/'));
}

function acceptedMediaScore(preferences, mediaType) {
  const [wantedType, wantedSubtype] = mediaType.split('/');
  let best = {
    quality: 0,
    specificity: -1,
    index: Number.MAX_SAFE_INTEGER,
  };

  for (const preference of preferences) {
    const [type, subtype] = preference.mediaRange.split('/');
    if ((type !== '*' && type !== wantedType) || (subtype !== '*' && subtype !== wantedSubtype)) {
      continue;
    }

    const specificity = Number(type !== '*') + Number(subtype !== '*');
    const candidate = {
      quality: preference.quality,
      specificity,
      index: preference.index,
    };
    if (compareAcceptScores(candidate, best) > 0) {
      best = candidate;
    }
  }

  return best;
}

function compareAcceptScores(left, right) {
  if (left.quality !== right.quality) {
    return left.quality - right.quality;
  }
  if (left.specificity !== right.specificity) {
    return left.specificity - right.specificity;
  }
  return right.index - left.index;
}

function renderRootDiscovery(discovery) {
  const resourceLinks = Object.entries(discovery.links.resources).map(([name, routePath]) => (
    `<li><a href="${escapeHtml(routePath)}">${escapeHtml(name)}</a> <code>${escapeHtml(routePath)}</code></li>`
  )).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>jsondb</title>
  <style>
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; background: #f8fafc; }
    main { max-width: 760px; margin: 0 auto; padding: 48px 20px; }
    h1 { margin: 0 0 8px; font-size: 2rem; line-height: 1.1; }
    p { color: #4b5563; }
    section { margin-top: 24px; }
    ul { display: grid; gap: 10px; padding: 0; list-style: none; }
    li { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 12px; border: 1px solid #d1d5db; border-radius: 8px; background: white; }
    a { font-weight: 700; color: #047857; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code { color: #475569; }
  </style>
</head>
<body>
  <main>
    <h1>jsondb</h1>
    <p>Local fixture database resources and tools.</p>

    <section aria-labelledby="tools-heading">
      <h2 id="tools-heading">Tools</h2>
      <ul>
        <li><a href="${escapeHtml(discovery.viewer)}">Data Viewer</a> <code>${escapeHtml(discovery.viewer)}</code></li>
        <li><a href="${escapeHtml(discovery.schema)}">Schema</a> <code>${escapeHtml(discovery.schema)}</code></li>
        <li><a href="${escapeHtml(discovery.graphql)}">GraphQL</a> <code>${escapeHtml(discovery.graphql)}</code></li>
      </ul>
    </section>

    <section aria-labelledby="resources-heading">
      <h2 id="resources-heading">Resources</h2>
      <ul>${resourceLinks || '<li>No resources loaded.</li>'}</ul>
    </section>
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function importCsvFixture(db, request, options = {}) {
  const filename = csvFilenameFromRequest(request);
  const body = await readRawBody(request, {
    maxBytes: maxBodyBytes(db),
  });
  parseCsvRecords(body.toString('utf8'), filename);

  await mkdir(db.config.sourceDir, { recursive: true });
  const outFile = path.join(db.config.sourceDir, filename);
  await writeFile(outFile, body);

  const project = await syncJsonFixtureDb(db.config, { allowErrors: true });
  db.resources = new Map(project.resources.map((resource) => [resource.name, resource]));
  db.diagnostics = project.diagnostics;
  db.schemaVersion = Date.now();

  const resourceName = filename.replace(/\.csv$/i, '');
  const resource = db.resources.get(resourceName);

  return {
    resource: resourceName,
    filename,
    dataPath: path.relative(db.config.cwd, outFile),
    statePath: path.relative(db.config.cwd, path.join(db.config.stateDir, 'state', `${resourceName}.json`)),
    routePath: resource?.routePath ?? `/${resourceName}`,
    viewerPath: `${options.viewerPath ?? '/__jsondb'}?resource=${encodeURIComponent(resourceName)}`,
    logs: project.logs,
  };
}

function csvFilenameFromRequest(request) {
  const rawName = headerValue(request, 'x-jsondb-file-name');
  if (!rawName) {
    throw jsonDbError(
      'CSV_IMPORT_MISSING_FILENAME',
      'CSV import requires an x-jsondb-file-name header.',
      {
        status: 400,
        hint: 'Upload with a filename ending in .csv.',
      },
    );
  }

  if (!String(rawName).toLowerCase().endsWith('.csv')) {
    throw jsonDbError(
      'CSV_IMPORT_INVALID_EXTENSION',
      `CSV import only accepts .csv files: ${rawName}`,
      {
        status: 400,
        hint: 'Choose a CSV file such as users.csv or products.csv.',
      },
    );
  }

  const base = path.basename(String(rawName)).replace(/\.csv$/i, '');
  const words = base.match(/[A-Za-z0-9]+/g) ?? [];
  const resourceName = words.map((word, index) => {
    const lower = word.toLowerCase();
    return index === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join('') || 'importedCsv';

  return `${/^\d/.test(resourceName) ? `csv${resourceName}` : resourceName}.csv`;
}

function headerValue(request, name) {
  if (typeof request.headers?.get === 'function') {
    return request.headers.get(name);
  }

  return request.headers?.[name] ?? request.headers?.[name.toLowerCase()];
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

async function executeRestBatchItem(db, item, options = {}) {
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
    options,
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

async function handleCollection(db, resource, id, request, response, url) {
  const collection = db.collection(resource.name);

  if (request.method === 'GET' && !id) {
    sendJson(response, 200, await shapeCollectionRead(db, resource, await collection.all(), url, { allowPagination: true }));
    return;
  }

  if (request.method === 'GET' && id) {
    const record = await collection.get(id);
    const body = record
      ? await shapeCollectionRead(db, resource, [record], url, { allowPagination: false })
      : null;
    sendJson(response, record ? 200 : 404, body?.[0] ?? { error: 'Not found' });
    return;
  }

  if (request.method === 'POST' && !id) {
    sendJson(response, 201, await collection.create(await readJsonBody(request, {
      maxBytes: maxBodyBytes(db),
    })));
    return;
  }

  if (request.method === 'PATCH' && id) {
    const record = await collection.patch(id, await readJsonBody(request, {
      maxBytes: maxBodyBytes(db),
    }));
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
    sendJson(response, 200, await document.put(await readJsonBody(request, {
      maxBytes: maxBodyBytes(db),
    })));
    return;
  }

  if (request.method === 'PATCH') {
    sendJson(response, 200, await document.update(await readJsonBody(request, {
      maxBytes: maxBodyBytes(db),
    })));
    return;
  }

  sendJson(response, 405, {
    error: 'Method not allowed',
  });
}
