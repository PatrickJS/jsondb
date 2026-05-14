import assert from 'node:assert/strict';
import test from 'node:test';
import { jsonDbContext, registerRestRoutes } from './hono.js';
import { openJsonFixtureDb } from '../index.js';
import { makeProject, writeFixture } from '../../test/helpers.js';

test('jsonDbContext reuses the opened db when created from options', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));
  const middleware = jsonDbContext({ cwd });
  const first = fakeContext();
  const second = fakeContext();
  let nextCalls = 0;

  await middleware(first, async () => {
    nextCalls += 1;
  });
  await middleware(second, async () => {
    nextCalls += 1;
  });

  assert.equal(nextCalls, 2);
  assert.equal(first.get('jsondb'), second.get('jsondb'));
});

test('registerRestRoutes supports prefix resource filters and hook short-circuiting', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'pages.json', JSON.stringify([{ id: 'home', title: 'Home' }]));
  await writeFixture(cwd, 'users.json', JSON.stringify([{ id: 'u_1', name: 'Ada' }]));
  const db = await openJsonFixtureDb({ cwd });
  const app = fakeHonoApp();

  registerRestRoutes(app, db, {
    prefix: '/api',
    resources: ['pages'],
    hooks: {
      beforeList(ctx) {
        assert.equal(ctx.resourceName, 'pages');
        assert.equal(ctx.method, 'list');
        return ctx.c.json({ error: 'Forbidden' }, 403);
      },
    },
  });

  assert.equal(Boolean(app.route('GET', '/api/pages')), true);
  assert.equal(Boolean(app.route('GET', '/api/users')), false);

  const response = await app.route('GET', '/api/pages').handler(fakeHonoContext());

  assert.deepEqual(response, {
    status: 403,
    body: {
      error: 'Forbidden',
    },
  });
});

test('registerRestRoutes supports resource hooks that mutate write bodies', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'pages.json', JSON.stringify([]));
  const db = await openJsonFixtureDb({ cwd });
  const app = fakeHonoApp();

  registerRestRoutes(app, db, {
    prefix: '/api',
    resourceOptions: {
      pages: {
        hooks: {
          beforeCreate(ctx) {
            ctx.body.title = ctx.body.title.trim();
          },
        },
      },
    },
  });

  const response = await app.route('POST', '/api/pages').handler(fakeHonoContext({
    body: {
      id: 'home',
      title: '  Home  ',
    },
  }));

  assert.equal(response.status, 201);
  assert.deepEqual(await db.collection('pages').get('home'), {
    id: 'home',
    title: 'Home',
  });
});

function fakeContext() {
  const values = new Map();
  return {
    set(key, value) {
      values.set(key, value);
    },
    get(key) {
      return values.get(key);
    },
  };
}

function fakeHonoApp() {
  const routes = [];
  const app = {
    routes,
    route(method, routePath) {
      return routes.find((route) => route.method === method && route.path === routePath);
    },
  };

  for (const method of ['get', 'post', 'patch', 'delete', 'put']) {
    app[method] = (routePath, handler) => {
      routes.push({
        method: method.toUpperCase(),
        path: routePath,
        handler,
      });
    };
  }

  return app;
}

function fakeHonoContext(options = {}) {
  return {
    req: {
      param(name) {
        return options.params?.[name];
      },
      async json() {
        return options.body ?? {};
      },
      url: options.url ?? 'http://jsondb.local/api/pages',
    },
    json(body, status = 200) {
      return {
        status,
        body,
      };
    },
    body(value, status = 200) {
      return {
        status,
        body: value,
      };
    },
  };
}
