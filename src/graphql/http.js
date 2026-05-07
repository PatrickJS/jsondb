import { makeGeneratedSchema } from '../schema.js';
import { serializeError } from '../errors.js';
import { readJsonBody, sendJson, sendText } from '../rest/handler.js';
import { executeGraphql } from './execute.js';

export async function handleGraphqlRequest(db, request, response) {
  try {
    await handleGraphqlRequestUnsafe(db, request, response);
  } catch (error) {
    sendJson(response, error.status ?? 500, serializeError(error, 'GRAPHQL_HTTP_ERROR'));
  }
}

async function handleGraphqlRequestUnsafe(db, request, response) {
  if (request.method === 'GET') {
    const schema = makeGeneratedSchema([...db.resources.values()]);
    sendText(response, 200, schema.graphql, 'text/plain; charset=utf-8');
    return;
  }

  if (request.method === 'POST') {
    const body = await readJsonBody(request, {
      maxBytes: Number(db.config.server?.maxBodyBytes ?? 1048576),
    });
    sendJson(response, 200, await executeGraphql(db, body));
    return;
  }

  sendJson(response, 405, {
    error: 'Method not allowed',
  });
}
