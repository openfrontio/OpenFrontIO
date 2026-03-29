import { describe, expect, test } from "vitest";
import { buildAssetUrl } from "../src/core/AssetUrls";

describe("AssetUrls", () => {
  test("returns hashed URLs for direct asset matches", () => {
    expect(
      buildAssetUrl("images/Favicon.svg", {
        "images/Favicon.svg": "/_assets/images/Favicon.hash.svg",
      }),
    ).toBe("/_assets/images/Favicon.hash.svg");
  });

  test("maps directory prefixes into the hashed asset namespace", () => {
    const manifest = {
      "maps/britanniaclassic/manifest.json":
        "/_assets/maps/britanniaclassic/manifest.hash.json",
      "maps/britanniaclassic/map.bin":
        "/_assets/maps/britanniaclassic/map.hash.bin",
    };

    expect(buildAssetUrl("maps", manifest)).toBe("/_assets/maps");
    expect(buildAssetUrl("maps/britanniaclassic", manifest)).toBe(
      "/_assets/maps/britanniaclassic",
    );
  });

  test("falls back to the unversioned path when manifest has no match", () => {
    expect(buildAssetUrl("images/unknown.svg", {})).toBe("/images/unknown.svg");
  });

  test("rejects dot segments in asset paths", () => {
    expect(() => buildAssetUrl("../api/instance", {})).toThrow(
      "Invalid asset path segment: ..",
    );
    expect(() => buildAssetUrl("images/%2e%2e/secret.svg", {})).toThrow(
      "Invalid asset path segment: %2e%2e",
    );
  });

  test("rejects empty asset paths", () => {
    expect(() => buildAssetUrl("", {})).toThrow("Asset path must not be empty");
    expect(() => buildAssetUrl("///", {})).toThrow(
      "Asset path must not be empty",
    );
  });
});
