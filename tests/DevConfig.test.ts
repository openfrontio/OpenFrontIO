/**
 * Tests for DevConfig module
 * Tests the development feature flag configuration system
 */

// Store original fetch for restoration
const originalFetch = global.fetch;

describe("DevConfig", () => {
  beforeEach(() => {
    // Reset modules before each test to clear cached config
    jest.resetModules();
    // Reset fetch mock
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("default configuration", () => {
    it("should have all features enabled by default", async () => {
      // Mock fetch to simulate missing config.json (404)
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 404,
      });

      const { getDevConfig, waitForDevConfig } = await import(
        "../src/client/DevConfig"
      );
      await waitForDevConfig();

      const config = getDevConfig();
      expect(config.features.analytics).toBe(true);
      expect(config.features.publicLobbies).toBe(true);
      expect(config.features.cloudflare).toBe(true);
      expect(config.features.ads).toBe(true);
    });
  });

  describe("config loading", () => {
    it("should load and merge config from config.json", async () => {
      const mockConfig = {
        features: {
          analytics: false,
          publicLobbies: false,
        },
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockConfig),
      });

      const { getDevConfig, waitForDevConfig } = await import(
        "../src/client/DevConfig"
      );
      await waitForDevConfig();

      const config = getDevConfig();
      // Explicitly set values
      expect(config.features.analytics).toBe(false);
      expect(config.features.publicLobbies).toBe(false);
      // Default values for unspecified features
      expect(config.features.cloudflare).toBe(true);
      expect(config.features.ads).toBe(true);
    });

    it("should handle fetch network errors gracefully", async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error("Network error"));

      const { getDevConfig, waitForDevConfig } = await import(
        "../src/client/DevConfig"
      );
      await waitForDevConfig();

      // Should fall back to defaults
      const config = getDevConfig();
      expect(config.features.analytics).toBe(true);
      expect(config.features.publicLobbies).toBe(true);
      expect(config.features.cloudflare).toBe(true);
      expect(config.features.ads).toBe(true);
    });

    it("should handle invalid JSON structure gracefully", async () => {
      const consoleSpy = jest
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      // Invalid structure: features is not an object
      const mockConfig = {
        features: "invalid",
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockConfig),
      });

      const { getDevConfig, waitForDevConfig } = await import(
        "../src/client/DevConfig"
      );
      await waitForDevConfig();

      // Should fall back to defaults
      const config = getDevConfig();
      expect(config.features.analytics).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith(
        "Invalid config.json structure, using defaults",
      );

      consoleSpy.mockRestore();
    });

    it("should handle null config gracefully", async () => {
      const consoleSpy = jest
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(null),
      });

      const { getDevConfig, waitForDevConfig } = await import(
        "../src/client/DevConfig"
      );
      await waitForDevConfig();

      const config = getDevConfig();
      expect(config.features.analytics).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith(
        "Invalid config.json structure, using defaults",
      );

      consoleSpy.mockRestore();
    });
  });

  describe("isDevFeatureEnabled", () => {
    it("should return correct value for each feature", async () => {
      const mockConfig = {
        features: {
          analytics: false,
          publicLobbies: true,
          cloudflare: false,
          ads: true,
        },
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockConfig),
      });

      const { isDevFeatureEnabled, waitForDevConfig } = await import(
        "../src/client/DevConfig"
      );
      await waitForDevConfig();

      expect(isDevFeatureEnabled("analytics")).toBe(false);
      expect(isDevFeatureEnabled("publicLobbies")).toBe(true);
      expect(isDevFeatureEnabled("cloudflare")).toBe(false);
      expect(isDevFeatureEnabled("ads")).toBe(true);
    });
  });

  describe("getDevConfig synchronous behavior", () => {
    it("should return defaults before async config loads", async () => {
      // Create a fetch that never resolves
      let resolvePromise: (value: any) => void;
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      (global.fetch as jest.Mock).mockReturnValue(pendingPromise);

      const { getDevConfig } = await import("../src/client/DevConfig");

      // Before config loads, should return defaults
      const config = getDevConfig();
      expect(config.features.analytics).toBe(true);
      expect(config.features.publicLobbies).toBe(true);

      // Cleanup: resolve the pending promise
      resolvePromise!({
        ok: false,
        status: 404,
      });
    });
  });

  describe("waitForDevConfig", () => {
    it("should return the loaded config", async () => {
      const mockConfig = {
        features: {
          analytics: false,
          ads: false,
        },
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockConfig),
      });

      const { waitForDevConfig } = await import("../src/client/DevConfig");
      const config = await waitForDevConfig();

      expect(config.features.analytics).toBe(false);
      expect(config.features.ads).toBe(false);
      expect(config.features.publicLobbies).toBe(true); // default
      expect(config.features.cloudflare).toBe(true); // default
    });

    it("should be idempotent - multiple calls return same config", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ features: { analytics: false } }),
      });

      const { waitForDevConfig } = await import("../src/client/DevConfig");

      const config1 = await waitForDevConfig();
      const config2 = await waitForDevConfig();

      // Both calls should return the same cached config object
      expect(config1).toBe(config2);
      expect(config1.features.analytics).toBe(false);
    });
  });
});
