import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPlayerCosmeticsRefs,
  isRandomSkinSelected,
  patternRelationship,
} from "../../src/client/Cosmetics";
import type { UserMeResponse } from "../../src/core/ApiSchemas";
import type { Pattern } from "../../src/core/CosmeticSchemas";

// Mock the Api module
vi.mock("../../src/client/Api", () => ({
  getApiBase: vi.fn(() => "http://localhost"),
  getUserMe: vi.fn(() => Promise.resolve(false)),
  createCheckoutSession: vi.fn(),
  hasLinkedAccount: vi.fn(() => false),
}));

const mockPatterns = {
  pattern_a: {
    name: "pattern_a",
    pattern: "base64data_a",
    colorPalettes: [{ name: "red", isArchived: false }],
    product: null,
    affiliateCode: null,
  } as unknown as Pattern,
  pattern_b: {
    name: "pattern_b",
    pattern: "base64data_b",
    colorPalettes: null,
    product: null,
    affiliateCode: null,
  } as unknown as Pattern,
};

const mockCosmetics = {
  patterns: mockPatterns,
  colorPalettes: {
    red: {
      name: "red",
      primaryColor: "#ff0000",
      secondaryColor: "#000000",
    },
  },
};

// Mock fetchCosmetics by mocking the fetch call
vi.stubGlobal(
  "fetch",
  vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve(mockCosmetics),
    }),
  ),
);

describe("Random Skin Selection", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe("isRandomSkinSelected", () => {
    it("returns false when no pattern is selected", () => {
      expect(isRandomSkinSelected()).toBe(false);
    });

    it("returns false when a specific pattern is selected", () => {
      localStorage.setItem("territoryPattern", "pattern:pattern_a:red");
      expect(isRandomSkinSelected()).toBe(false);
    });

    it("returns true when random is selected", () => {
      localStorage.setItem("territoryPattern", "random");
      expect(isRandomSkinSelected()).toBe(true);
    });
  });

  describe("patternRelationship", () => {
    const pattern = mockPatterns.pattern_a;

    it("returns owned when user has pattern:* flare", () => {
      const userMe = {
        player: { flares: ["pattern:*"] },
      } as unknown as UserMeResponse;
      expect(patternRelationship(pattern, { name: "red" }, userMe, null)).toBe(
        "owned",
      );
    });

    it("returns owned when user has specific flare", () => {
      const userMe = {
        player: { flares: ["pattern:pattern_a:red"] },
      } as unknown as UserMeResponse;
      expect(patternRelationship(pattern, { name: "red" }, userMe, null)).toBe(
        "owned",
      );
    });

    it("returns blocked when user has no flares and pattern not for sale", () => {
      const userMe = {
        player: { flares: [] },
      } as unknown as UserMeResponse;
      expect(patternRelationship(pattern, { name: "red" }, userMe, null)).toBe(
        "blocked",
      );
    });
  });

  describe("getPlayerCosmeticsRefs with random", () => {
    it("returns no pattern when random is set but user owns no skins", async () => {
      localStorage.setItem("territoryPattern", "random");
      const refs = await getPlayerCosmeticsRefs();
      // With no owned patterns (getUserMe returns false, no flares),
      // resolveRandomPattern returns null
      expect(refs.patternName).toBeUndefined();
    });

    it("returns no pattern when cosmetics schema validation fails", async () => {
      localStorage.setItem("territoryPattern", "pattern:pattern_a:red");
      const refs = await getPlayerCosmeticsRefs();
      // fetchCosmetics returns null because mock data doesn't pass
      // CosmeticsSchema validation, so getSelectedPatternName(null)
      // returns null and patternName is undefined
      expect(refs.patternName).toBeUndefined();
    });
  });
});
