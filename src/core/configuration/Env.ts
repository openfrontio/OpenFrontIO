/**
 * Safely access environment variables in both Node.js and Vite environments.
 * - In Vite (Browser), it uses `import.meta.env`.
 * - In Node.js (Server), it uses `process.env`.
 */

declare global {
  interface ImportMetaEnv {
    [key: string]: string | boolean | undefined;
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
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

export const Env = {
  get GAME_ENV(): string {
    // Check MODE for Vite, GAME_ENV for Node
    try {
      if (
        typeof import.meta !== "undefined" &&
        import.meta.env &&
        import.meta.env.MODE
      ) {
        return import.meta.env.MODE;
      }
    } catch {
      // Ignore errors accessing import.meta
    }

    return getEnv("GAME_ENV") ?? "dev";
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
  get GIT_COMMIT() {
    return getEnv("GIT_COMMIT");
  },
  get API_KEY() {
    return getEnv("API_KEY");
  },
  get ADMIN_TOKEN() {
    return getEnv("ADMIN_TOKEN");
  },
};
