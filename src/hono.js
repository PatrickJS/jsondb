import { openJsonFixtureDb } from './db.js';
import { serializeError } from './errors.js';
import { executeGraphql } from './graphql/index.js';
import { makeGeneratedSchema } from './schema.js';
import { openSqliteJsonDb } from './sqlite.js';

export async function createJsonDbHonoApp(options = {}) {
  const { Hono } = await importHono();
  const app = new Hono();
  const db = await openHonoDb(options);
  const api = normalizeApi(options.api ?? ['rest']);

  app.use('*', jsonDbContext(db));
  app.onError((error, c) => c.json(serializeError(error, 'HONO_JSONDB_ERROR'), error.status ?? 500));

  if (api.includes('rest')) {
    registerRestRoutes(app, db);
  }

  if (api.includes('graphql')) {
    const graphqlPath = options.graphqlPath ?? options.graphql?.path ?? '/graphql';
    app.get(graphqlPath, (c) => c.text(makeGeneratedSchema([...db.resources.values()]).graphql));
    app.post(graphqlPath, async (c) => c.json(await executeGraphql(db, await c.req.json())));
  }

  return app;
}

export function jsonDbContext(dbOrOptions) {
  return async (c, next) => {
    const db = typeof dbOrOptions?.collection === 'function'
      ? dbOrOptions
      : await openHonoDb(dbOrOptions ?? {});
    c.set('jsondb', db);
    await next();
  };
}

export async function createJsonDbContext(options = {}) {
  return jsonDbContext(await openHonoDb(options));
}

async function openHonoDb(options) {
  if (options.storage?.kind === 'sqlite') {
    return openSqliteJsonDb(options);
  }

  return openJsonFixtureDb(options);
}

function registerRestRoutes(app, db) {
  for (const resource of db.resources.values()) {
    if (resource.kind === 'collection') {
      app.get(resource.routePath, async (c) => c.json(await db.collection(resource.name).all()));
      app.get(`${resource.routePath}/:id`, async (c) => {
        const record = await db.collection(resource.name).get(c.req.param('id'));
        return record ? c.json(record) : c.json({ error: 'Not found' }, 404);
      });
      app.post(resource.routePath, async (c) => c.json(await db.collection(resource.name).create(await c.req.json()), 201));
      app.patch(`${resource.routePath}/:id`, async (c) => {
        const record = await db.collection(resource.name).patch(c.req.param('id'), await c.req.json());
        return record ? c.json(record) : c.json({ error: 'Not found' }, 404);
      });
      app.delete(`${resource.routePath}/:id`, async (c) => {
        const deleted = await db.collection(resource.name).delete(c.req.param('id'));
        return deleted ? c.body(null, 204) : c.json({ error: 'Not found' }, 404);
      });
    } else {
      app.get(resource.routePath, async (c) => c.json(await db.document(resource.name).all()));
      app.put(resource.routePath, async (c) => c.json(await db.document(resource.name).put(await c.req.json())));
      app.patch(resource.routePath, async (c) => c.json(await db.document(resource.name).update(await c.req.json())));
    }
  }
}

function normalizeApi(value) {
  return Array.isArray(value) ? value : String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

async function importHono() {
  try {
    return await import('hono');
  } catch (error) {
    throw new Error(`json-fixture-db/hono requires hono to be installed in your app: ${error.message}`);
  }
}
