import path from 'node:path';
import { syncJsonResourceState } from '../storage/json.js';

export async function syncStateResource(config, resource, sourceMetadata) {
  await syncJsonResourceState(config, resource, sourceMetadata);
}
