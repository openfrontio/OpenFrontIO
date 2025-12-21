// Development configuration for disabling external services
// Create a config.json in the project root to override these defaults

export interface DevSettingsConfig {
  themeMode?: "light" | "dark" | "system";
  darkMode?: boolean; // Legacy, use themeMode instead
  emojis?: boolean;
  alertFrame?: boolean;
  specialEffects?: boolean;
  structureSprites?: boolean;
  cursorCostLabel?: boolean;
  leftClickOpensMenu?: boolean;
  anonymousNames?: boolean;
  lobbyIdVisibility?: boolean;
  territoryPatterns?: boolean;
  performanceOverlay?: boolean;
  attackRatio?: number;
  backgroundMusicVolume?: number;
  soundEffectsVolume?: number;
}

export interface DevFeatureConfig {
  features: {
    analytics: boolean;
    publicLobbies: boolean;
    cloudflare: boolean;
    ads: boolean;
  };
  settings?: DevSettingsConfig;
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
async function loadConfig(): Promise<DevFeatureConfig> {
  try {
    const response = await fetch("/config.json");
    if (response.ok) {
      const config = await response.json();
      const mergedConfig: DevFeatureConfig = {
        features: { ...defaultConfig.features, ...config.features },
        settings: config.settings,
      };
      cachedConfig = mergedConfig;
      console.log("Loaded dev config from config.json:", mergedConfig);

      // Apply settings to localStorage if provided in config
      if (config.settings) {
        applyConfigSettings(config.settings);
      }

      return mergedConfig;
    }
  } catch {
    // config.json not found, use defaults
  }

  cachedConfig = defaultConfig;
  return defaultConfig;
}

/**
 * Apply settings from config.json to localStorage
 * Only applies if the setting hasn't been modified by the user
 */
function applyConfigSettings(settings: DevSettingsConfig) {
  const applyBool = (key: string, value: boolean | undefined) => {
    if (value !== undefined && localStorage.getItem(key) === null) {
      localStorage.setItem(key, value.toString());
    }
  };

  const applyFloat = (key: string, value: number | undefined) => {
    if (value !== undefined && localStorage.getItem(key) === null) {
      localStorage.setItem(key, value.toString());
    }
  };

  const applyString = (key: string, value: string | undefined) => {
    if (value !== undefined && localStorage.getItem(key) === null) {
      localStorage.setItem(key, value);
    }
  };

  applyString("settings.themeMode", settings.themeMode);
  applyBool("settings.darkMode", settings.darkMode);
  applyBool("settings.emojis", settings.emojis);
  applyBool("settings.alertFrame", settings.alertFrame);
  applyBool("settings.specialEffects", settings.specialEffects);
  applyBool("settings.structureSprites", settings.structureSprites);
  applyBool("settings.cursorCostLabel", settings.cursorCostLabel);
  applyBool("settings.leftClickOpensMenu", settings.leftClickOpensMenu);
  applyBool("settings.anonymousNames", settings.anonymousNames);
  applyBool("settings.lobbyIdVisibility", settings.lobbyIdVisibility);
  applyBool("settings.territoryPatterns", settings.territoryPatterns);
  applyBool("settings.performanceOverlay", settings.performanceOverlay);
  applyFloat("settings.attackRatio", settings.attackRatio);
  applyFloat("settings.backgroundMusicVolume", settings.backgroundMusicVolume);
  applyFloat("settings.soundEffectsVolume", settings.soundEffectsVolume);
}

// Auto-load config at module initialization
const configPromise: Promise<DevFeatureConfig> = loadConfig();

/**
 * Wait for dev config to be loaded (use in async contexts)
 */
export async function waitForDevConfig(): Promise<DevFeatureConfig> {
  return configPromise;
}

/**
 * Get configuration synchronously (may return defaults if not yet loaded)
 */
export function getDevConfig(): DevFeatureConfig {
  return cachedConfig ?? defaultConfig;
}

/**
 * Check if a feature is enabled
 */
export function isDevFeatureEnabled(
  feature: keyof DevFeatureConfig["features"],
): boolean {
  return getDevConfig().features[feature];
}

/**
 * @deprecated Use waitForDevConfig() instead
 */
export const loadDevConfig = waitForDevConfig;
