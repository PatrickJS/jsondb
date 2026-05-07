export function createJsonDbClient(options = {}) {
  const baseUrl = options.baseUrl ?? '';
  const batching = normalizeBatching(options.batching);

  const graphqlQueue = createQueue((requests) => graphqlBatch(requests), batching);
  const restQueue = createQueue((requests) => restBatch(requests), batching);

  async function graphql(query, variables, requestOptions = {}) {
    const request = typeof query === 'string' ? { query, variables } : query;
    if (shouldBatch(requestOptions, batching)) {
      return graphqlQueue({ request });
    }

    return postJson(resolveUrl(baseUrl, options.graphqlPath ?? '/graphql'), request);
  }

  async function graphqlBatch(requests) {
    return postJson(resolveUrl(baseUrl, options.graphqlPath ?? '/graphql'), requests);
  }

  async function rest(method, path, body, requestOptions = {}) {
    const request = normalizeRestRequest(method, path, body);
    if (shouldBatch(requestOptions, batching)) {
      return restQueue({ request });
    }

    return restDirect(request);
  }

  async function restDirect(request) {
    const init = {
      method: request.method,
      headers: {
        'content-type': 'application/json',
      },
    };

    if (!['GET', 'DELETE'].includes(request.method) && request.body !== undefined) {
      init.body = JSON.stringify(request.body);
    }

    const response = await fetch(resolveUrl(baseUrl, request.path), init);
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await readResponseBody(response),
    };
  }

  async function restBatch(requests) {
    return postJson(resolveUrl(baseUrl, options.restBatchPath ?? '/__jsondb/batch'), requests.map(normalizeRestRequestObject));
  }

  graphql.batch = graphqlBatch;
  graphql.request = graphql;
  rest.batch = restBatch;
  rest.request = rest;
  rest.get = (path, requestOptions) => rest('GET', path, undefined, requestOptions);
  rest.post = (path, body, requestOptions) => rest('POST', path, body, requestOptions);
  rest.patch = (path, body, requestOptions) => rest('PATCH', path, body, requestOptions);
  rest.put = (path, body, requestOptions) => rest('PUT', path, body, requestOptions);
  rest.delete = (path, requestOptions) => rest('DELETE', path, undefined, requestOptions);

  return {
    graphql,
    rest,
  };
}

function normalizeBatching(value) {
  if (value === true) {
    return {
      enabled: true,
      delayMs: 10,
      dedupe: true,
    };
  }

  if (!value) {
    return {
      enabled: false,
      delayMs: 10,
      dedupe: true,
    };
  }

  return {
    enabled: Boolean(value.enabled),
    delayMs: Number(value.delayMs ?? 10),
    dedupe: value.dedupe !== false,
  };
}

function shouldBatch(requestOptions, batching) {
  if (requestOptions?.batch === false) {
    return false;
  }

  if (requestOptions?.batch === true) {
    return true;
  }

  return batching.enabled;
}

function createQueue(flush, batching) {
  let pending = [];
  let timer = null;

  return (item) => new Promise((resolve, reject) => {
    pending.push({
      ...item,
      resolve,
      reject,
    });

    if (!timer) {
      timer = setTimeout(async () => {
        const items = pending;
        pending = [];
        timer = null;

        try {
          const groups = batching.dedupe ? groupQueuedItems(items) : items.map((queued) => ({
            request: queued.request,
            queued: [queued],
          }));
          const results = await flush(groups.map((group) => group.request));
          groups.forEach((group, index) => {
            for (const queued of group.queued) {
              queued.resolve(results[index]);
            }
          });
        } catch (error) {
          items.forEach((queued) => queued.reject(error));
        }
      }, batching.delayMs);
    }
  });
}

function groupQueuedItems(items) {
  const groups = new Map();

  for (const item of items) {
    const key = stableStringify(item.request);
    const group = groups.get(key);
    if (group) {
      group.queued.push(item);
    } else {
      groups.set(key, {
        request: item.request,
        queued: [item],
      });
    }
  }

  return [...groups.values()];
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  return readResponseBody(response);
}

async function readResponseBody(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function normalizeRestRequest(method, path, body) {
  if (typeof method === 'object' && method !== null) {
    return normalizeRestRequestObject(method);
  }

  return normalizeRestRequestObject({
    method,
    path,
    body,
  });
}

function normalizeRestRequestObject(request) {
  return {
    method: String(request.method ?? 'GET').toUpperCase(),
    path: request.path ?? '/',
    body: request.body,
  };
}

function resolveUrl(baseUrl, path) {
  if (!baseUrl) {
    return path;
  }

  return new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).href;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}
