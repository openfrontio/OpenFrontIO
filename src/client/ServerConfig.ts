/**
 * Server configuration injected at build time from environment variables.
 * Available immediately when the client loads via window.SERVER_CONFIG.
 *
 * The global type declaration is in src/core/configuration/Env.ts
 */

export interface ServerConfig {
  gameEnv: string;
  numWorkers: number;
}

/**
 * Get the server configuration injected into the HTML at build time.
 * @returns The server configuration object
 */
export function getServerConfig(): ServerConfig {
  if (!window.SERVER_CONFIG) {
    throw new Error("SERVER_CONFIG not available on window");
  }
  return window.SERVER_CONFIG;
}
