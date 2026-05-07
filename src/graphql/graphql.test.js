import assert from 'node:assert/strict';
import test from 'node:test';
import { openJsonFixtureDb } from '../index.js';
import { makeProject, writeFixture } from '../../test/helpers.js';
import { executeGraphql } from './index.js';

test('dependency-free GraphQL queries support aliases and variables', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true },
      "email": { "type": "string", "required": true },
      "profile": {
        "type": "object",
        "fields": {
          "title": { "type": "string" }
        }
      }
    },
    "seed": [
      {
        "id": "u_1",
        "name": "Ada Lovelace",
        "email": "ada@example.com",
        "profile": { "title": "Admin" }
      }
    ]
  }`);

  const db = await openJsonFixtureDb({ cwd });
  const result = await executeGraphql(db, {
    query: `query GetUser($id: ID!) {
      allUsers: users {
        id
        displayName: name
      }
      ada: user(id: $id) {
        emailAddress: email
        profile {
          jobTitle: title
        }
      }
    }`,
    variables: {
      id: 'u_1',
    },
  });

  assert.deepEqual(result, {
    data: {
      allUsers: [
        {
          id: 'u_1',
          displayName: 'Ada Lovelace',
        },
      ],
      ada: {
        emailAddress: 'ada@example.com',
        profile: {
          jobTitle: 'Admin',
        },
      },
    },
  });
});

test('dependency-free GraphQL supports repeated root fields with aliases in one request', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      email: 'ada@example.com',
    },
  ]));

  const db = await openJsonFixtureDb({ cwd });
  const result = await executeGraphql(db, {
    query: `{
      users {
        id
        email
      }
      secondUsers: users {
        id
        email
      }
    }`,
  });

  assert.deepEqual(result, {
    data: {
      users: [
        {
          id: 'u_1',
          email: 'ada@example.com',
        },
      ],
      secondUsers: [
        {
          id: 'u_1',
          email: 'ada@example.com',
        },
      ],
    },
  });
});

test('dependency-free GraphQL collection mutations create update and delete records', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true },
      "email": { "type": "string", "required": true },
      "role": {
        "type": "enum",
        "values": ["admin", "user"],
        "default": "user"
      }
    },
    "seed": []
  }`);

  const db = await openJsonFixtureDb({ cwd });
  const created = await executeGraphql(db, {
    query: `mutation CreateUser($input: JSON!) {
      created: createUser(input: $input) {
        id
        name
        role
      }
    }`,
    variables: {
      input: {
        id: 'u_2',
        name: 'Grace Hopper',
        email: 'grace@example.com',
      },
    },
  });

  assert.deepEqual(created, {
    data: {
      created: {
        id: 'u_2',
        name: 'Grace Hopper',
        role: 'user',
      },
    },
  });

  const updated = await executeGraphql(db, {
    query: `mutation {
      updateUser(id: "u_2", patch: { role: "admin" }) {
        id
        role
      }
    }`,
  });

  assert.deepEqual(updated, {
    data: {
      updateUser: {
        id: 'u_2',
        role: 'admin',
      },
    },
  });

  const deleted = await executeGraphql(db, {
    query: `mutation {
      removed: deleteUser(id: "u_2")
    }`,
  });

  assert.deepEqual(deleted, {
    data: {
      removed: true,
    },
  });
});

test('dependency-free GraphQL document queries and mutations work', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'settings.json', JSON.stringify({
    theme: 'light',
    locale: 'en-US',
    features: {
      billing: false,
    },
  }));

  const db = await openJsonFixtureDb({ cwd });
  const updated = await executeGraphql(db, {
    query: `mutation {
      updateSettings(patch: { theme: "dark" }) {
        theme
        locale
      }
      setSettings(path: "/features/billing", value: true) {
        features {
          billing
        }
      }
    }`,
  });

  assert.deepEqual(updated, {
    data: {
      updateSettings: {
        theme: 'dark',
        locale: 'en-US',
      },
      setSettings: {
        features: {
          billing: true,
        },
      },
    },
  });

  const queried = await executeGraphql(db, {
    query: `{
      appSettings: settings {
        theme
        features {
          billingEnabled: billing
        }
      }
    }`,
  });

  assert.deepEqual(queried, {
    data: {
      appSettings: {
        theme: 'dark',
        features: {
          billingEnabled: true,
        },
      },
    },
  });
});

test('dependency-free GraphQL supports batched requests', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true }
    },
    "seed": [
      { "id": "u_1", "name": "Ada Lovelace" }
    ]
  }`);
  await writeFixture(cwd, 'settings.json', JSON.stringify({
    theme: 'light',
  }));

  const db = await openJsonFixtureDb({ cwd });
  const result = await executeGraphql(db, [
    {
      query: '{ users { id name } }',
    },
    {
      query: '{ settings { theme } }',
    },
  ]);

  assert.deepEqual(result, [
    {
      data: {
        users: [
          {
            id: 'u_1',
            name: 'Ada Lovelace',
          },
        ],
      },
    },
    {
      data: {
        settings: {
          theme: 'light',
        },
      },
    },
  ]);
});
