import { makeGeneratedSchema } from '../schema.js';
import { readJsonBody, sendJson, sendText } from '../rest/handler.js';
import { executeGraphql } from './execute.js';

export async function handleGraphqlRequest(db, request, response) {
  if (request.method === 'GET') {
    const schema = makeGeneratedSchema([...db.resources.values()]);
    sendText(response, 200, schema.graphql, 'text/plain; charset=utf-8');
    return;
  }

  if (request.method === 'POST') {
    const body = await readJsonBody(request);
    sendJson(response, 200, await executeGraphql(db, body));
    return;
  }

  sendJson(response, 405, {
    error: 'Method not allowed',
  });
}
