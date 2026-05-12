import type { JsonDbOptions } from './index.d.ts';

export type JsonDbVitePluginOptions = Pick<JsonDbOptions, 'cwd' | 'configPath' | 'dbDir' | 'sourceDir' | 'stateDir' | 'mode' | 'types' | 'schema' | 'defaults' | 'seed' | 'collections' | 'server' | 'rest' | 'graphql' | 'mock'> & {
  /** Scoped base for jsondb dev tools. Defaults to "/__jsondb". */
  apiBase?: string;
  /** Serve root REST routes such as "/users" during Vite dev. Defaults to false. */
  rootRoutes?: boolean;
  /** Scoped REST resource base. Defaults to "<apiBase>/rest". */
  restBasePath?: string;
  /** Scoped GraphQL endpoint. Defaults to "<apiBase>/graphql". */
  graphqlPath?: string;
  /** Virtual module id for the browser-safe client. Defaults to "virtual:jsondb/client"; false disables it. */
  clientVirtualModule?: string | false;
};

export type ViteLikePlugin = {
  name: string;
  apply: 'serve';
  configureServer(server: {
    middlewares: {
      use(middleware: (request: unknown, response: unknown, next: () => void) => void): void;
    };
    httpServer?: {
      once(event: 'close', callback: () => void): void;
    };
    config?: {
      logger?: {
        warn(message: string): void;
      };
    };
  }): void | Promise<void>;
  resolveId(id: string): string | null | Promise<string | null>;
  load(id: string): string | null | Promise<string | null>;
};

export function jsondbPlugin(options?: JsonDbVitePluginOptions): ViteLikePlugin;
