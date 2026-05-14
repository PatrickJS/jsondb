import { assertRecordMatchesResource } from '../../schema.js';
import { getPointer, setPointer } from './json-pointer.js';
import { readJsonState, statePathForResource, withJsonStateWrite, writeJsonState } from './state.js';

export class JsonDbDocument {
  constructor(config, resource) {
    this.config = config;
    this.resource = resource;
    this.path = statePathForResource(config, resource.name);
  }

  async all() {
    return readJsonState(this.path, {});
  }

  async get(pointer = '') {
    const document = await this.all();
    return pointer ? getPointer(document, pointer) : document;
  }

  async put(value) {
    return withJsonStateWrite(this.path, async () => {
      assertRecordMatchesResource(value, this.resource, this.config, {
        source: `${this.resource.name} document body`,
      });
      await writeJsonState(this.path, value);
      return value;
    });
  }

  async set(pointer, value) {
    return withJsonStateWrite(this.path, async () => {
      const document = await this.all();
      setPointer(document, pointer, value);
      assertRecordMatchesResource(document, this.resource, this.config, {
        source: `${this.resource.name} document body`,
      });
      await writeJsonState(this.path, document);
      return value;
    });
  }

  async update(patch) {
    return withJsonStateWrite(this.path, async () => {
      const document = await this.all();
      const nextDocument = {
        ...document,
        ...patch,
      };
      assertRecordMatchesResource(nextDocument, this.resource, this.config, {
        source: `${this.resource.name} document patch body`,
      });
      await writeJsonState(this.path, nextDocument);
      return nextDocument;
    });
  }
}
