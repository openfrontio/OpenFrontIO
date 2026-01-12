/**
 * Safely access environment variables in both Node.js and Vite environments.
 * - In Vite (Browser), it uses `import.meta.env`.
 * - In Node.js (Server), it uses `process.env`.
 */

import { GameEnv } from "./Config";

export interface ServerConfigVars {
  gameEnv: string;
  numWorkers: number;
  gitCommit: string;
}

declare global {
  interface ImportMetaEnv {
    [key: string]: string | boolean | undefined;
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
  interface Window {
    SERVER_CONFIG?: ServerConfigVars;
  }
}

function getEnv(key: string, viteKey?: string): string | undefined {
  const vKey = viteKey ?? key;

  // Try import.meta.env (Vite/Browser)
  // We use a try-catch block or check existence to avoid ReferenceErrors
  try {
    if (typeof import.meta !== "undefined" && import.meta.env) {
      const val = import.meta.env[vKey] ?? import.meta.env[key];
      if (val !== undefined) {
        return String(val);
      }
    }
  } catch {
    // Ignore errors accessing import.meta
  }

  // Try process.env (Node.js)
  try {
    if (typeof process !== "undefined" && process.env) {
      const val = process.env[key];
      if (val !== undefined) {
        return val;
      }
    }
  } catch {
    // Ignore errors accessing process
  }

  return undefined;
}

// Helper function to get GameEnv value case-insensitively
function getGameEnvValue(envString: string | undefined): GameEnv {
  if (!envString) {
    throw new Error("GAME_ENV is not defined");
  }

  const normalizedEnv = envString.toLowerCase();
  const enumKey = Object.keys(GameEnv).find(
    (key) => key.toLowerCase() === normalizedEnv,
  );

  return enumKey ? GameEnv[enumKey as keyof typeof GameEnv] : GameEnv.Dev;
}

export const Env = {
  get GAME_ENV(): GameEnv {
    // Check window.SERVER_CONFIG first (injected at build time)
    try {
      if (typeof window !== "undefined" && window.SERVER_CONFIG) {
        console.log("using server config from window");
        return getGameEnvValue(window.SERVER_CONFIG.gameEnv);
      }
    } catch {
      // Ignore errors accessing window
    }

    // Check MODE for Vite, GAME_ENV for Node
    try {
      if (
        typeof import.meta !== "undefined" &&
        import.meta.env &&
        import.meta.env.MODE
      ) {
        console.log("using server config from import.meta.env");
        return getGameEnvValue(import.meta.env.MODE);
      }
    } catch {
      // Ignore errors accessing import.meta
    }
    console.log("using server config from environment variable");
    return getGameEnvValue(getEnv("GAME_ENV"));
  },

  get TURNSTILE_SECRET_KEY() {
    return getEnv("TURNSTILE_SECRET_KEY");
  },
  get STRIPE_PUBLISHABLE_KEY() {
    return getEnv("STRIPE_PUBLISHABLE_KEY");
  },
  get DOMAIN() {
    return getEnv("DOMAIN");
  },
  get SUBDOMAIN() {
    return getEnv("SUBDOMAIN");
  },
  get OTEL_EXPORTER_OTLP_ENDPOINT() {
    return getEnv("OTEL_EXPORTER_OTLP_ENDPOINT");
  },
  get OTEL_AUTH_HEADER() {
    return getEnv("OTEL_AUTH_HEADER");
  },
  get GIT_COMMIT(): string | undefined {
    try {
      if (typeof window !== "undefined" && window.SERVER_CONFIG) {
        return window.SERVER_CONFIG.gitCommit;
      }
    } catch {
      // Ignore errors accessing window
    }
    return getEnv("GIT_COMMIT");
  },
  get API_KEY() {
    return getEnv("API_KEY");
  },
  get ADMIN_TOKEN() {
    return getEnv("ADMIN_TOKEN");
  },
  get NUM_WORKERS() {
    // Check window.SERVER_CONFIG first (injected at build time)
    try {
      if (typeof window !== "undefined" && window.SERVER_CONFIG) {
        return String(window.SERVER_CONFIG.numWorkers);
      }
    } catch {
      // Ignore errors accessing window
    }

    return getEnv("NUM_WORKERS");
  },
};
