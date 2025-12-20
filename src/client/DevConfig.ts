// Development configuration for disabling external services
// Create a config.json in the project root to override these defaults

export interface DevFeatureConfig {
  features: {
    analytics: boolean;
    publicLobbies: boolean;
    cloudflare: boolean;
    ads: boolean;
  };
}

const defaultConfig: DevFeatureConfig = {
  features: {
    analytics: true,
    publicLobbies: true,
    cloudflare: true,
    ads: true,
  },
};

let cachedConfig: DevFeatureConfig | null = null;

/**
 * Load development configuration from config.json
 * Falls back to default config if file doesn't exist
 */
export async function loadDevConfig(): Promise<DevFeatureConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    const response = await fetch("/config.json");
    if (response.ok) {
      const config = await response.json();
      const mergedConfig: DevFeatureConfig = {
        features: { ...defaultConfig.features, ...config.features },
      };
      cachedConfig = mergedConfig;
      console.log("Loaded dev config from config.json:", mergedConfig);
      return mergedConfig;
    }
  } catch {
    // config.json not found, use defaults
  }

  cachedConfig = defaultConfig;
  return defaultConfig;
}

/**
 * Get configuration synchronously (must call loadDevConfig() first)
 */
export function getDevConfig(): DevFeatureConfig {
  if (!cachedConfig) {
    console.warn(
      "Dev config not loaded yet, using defaults. Call loadDevConfig() first.",
    );
    cachedConfig = defaultConfig;
  }
  return cachedConfig;
}

/**
 * Check if a feature is enabled
 */
export function isDevFeatureEnabled(
  feature: keyof DevFeatureConfig["features"],
): boolean {
  return getDevConfig().features[feature];
}
