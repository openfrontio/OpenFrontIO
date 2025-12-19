// Configuration loader for local development settings
export interface AppConfig {
  features: {
    analytics: boolean;
    publicLobbies: boolean;
    cloudflare: boolean;
    ads: boolean;
  };
  development: {
    offlineMode: boolean;
  };
}

// Default configuration
const defaultConfig: AppConfig = {
  features: {
    analytics: false,
    publicLobbies: false,
    cloudflare: false,
    ads: false,
  },
  development: {
    offlineMode: true,
  },
};

let cachedConfig: AppConfig | null = null;

/**
 * Load configuration from config.json
 * Falls back to default config if file doesn't exist
 */
export async function loadConfig(): Promise<AppConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    const response = await fetch("/config.json");
    if (response.ok) {
      const config = await response.json();
      const mergedConfig: AppConfig = { ...defaultConfig, ...config };
      cachedConfig = mergedConfig;
      console.log("Loaded config from config.json:", mergedConfig);
      return mergedConfig;
    }
  } catch (error) {
    console.log("No config.json found, using default configuration");
  }

  cachedConfig = defaultConfig;
  return defaultConfig;
}

/**
 * Get configuration synchronously (must call loadConfig() first)
 */
export function getConfig(): AppConfig {
  if (!cachedConfig) {
    console.warn(
      "Config not loaded yet, using defaults. Call loadConfig() first.",
    );
    cachedConfig = defaultConfig;
  }
  return cachedConfig;
}

/**
 * Check if a feature is enabled
 */
export function isFeatureEnabled(
  feature: keyof AppConfig["features"],
): boolean {
  const config = getConfig();
  return config.features[feature];
}
