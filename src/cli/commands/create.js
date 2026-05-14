import { openJsonFixtureDb } from '../../db.js';

export async function runCreate(config, args) {
  const [collectionName, json] = args;
  if (!collectionName || !json) {
    throw new Error('Usage: jsondb create <collection> <json>');
  }

  const db = await openJsonFixtureDb({
    ...config,
    syncOnOpen: true,
  });
  const record = await db.collection(collectionName).create(JSON.parse(json));
  console.log(JSON.stringify(record, null, 2));
}
