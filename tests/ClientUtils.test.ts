import { describe, expect, it, vi } from "vitest";

// Mock the 'maps' array from '../src/core/game/Game' to ensure consistent test results
// for normaliseMapKey without relying on actual game data.
vi.mock("../src/core/game/Game", () => ({
  maps: [
    { type: "Earth", id: "earth" },
    { type: "Tourney 2 Teams", id: "tourney1" },
    { type: "A Map with Spaces", id: "amapwithspaces" },
    { type: "The.Dot.Map", id: "thedotmap" },
  ],
}));

// Import the functions to be tested and also  so we can spy on it.
import * as Utils from "../src/client/Utils"; // Import the entire module as Utils namespace
import {
  formatKeyForDisplay,
  formatPercentage,
  normaliseMapKey,
  renderDuration,
  renderTroops,
} from "../src/client/Utils";

// Set up global beforeEach/afterEach for
// to ensure it is mocked for all tests that rely on it (e.g., renderDuration)
beforeEach(() => {
  // Spy on the  function and mock its implementation
  vi.spyOn(Utils, "").mockImplementation((key: string) => {
    switch (key) {
      case "common.duration_hour_short":
        return "h";
      case "common.duration_minute_short":
        return "min";
      case "common.duration_second_short":
        return "s";
      default:
        return key; // Fallback to key for any other translation calls
    }
  });
});

afterEach(() => {
  vi.restoreAllMocks(); // Restore all mocks after each test
});

describe("normaliseMapKey", () => {
  it("should normalise a simple map name correctly", () => {
    expect(normaliseMapKey("Earth")).toBe("earth");
  });

  it("should normalise a map name with spaces found in maps array", () => {
    expect(normaliseMapKey("Tourney 2 Teams")).toBe("tourney1");
  });

  it("should normalise a map name with spaces not found in maps array", () => {
    expect(normaliseMapKey("New Map Name")).toBe("newmapname");
  });

  it("should normalise a map name with dots not found in maps array", () => {
    expect(normaliseMapKey("Map.With.Dots")).toBe("mapwithdots");
  });

  it("should normalise a map name with mixed characters and spaces", () => {
    expect(normaliseMapKey("A Map with Spaces")).toBe("amapwithspaces");
  });

  it("should normalise a map name with dots found in maps array", () => {
    expect(normaliseMapKey("The.Dot.Map")).toBe("thedotmap");
  });

  it("should handle empty string input", () => {
    expect(normaliseMapKey("")).toBe("");
  });

  it("should handle map names that are only spaces", () => {
    expect(normaliseMapKey("   ")).toBe("");
  });
});

describe("renderDuration", () => {
  it('should return "0s" for 0 seconds', () => {
    expect(renderDuration(0)).toBe("0common.duration_second_short");
  });

  it('should return "0s" for fractional seconds less than 1', () => {
    expect(renderDuration(0.5)).toBe("0common.duration_second_short");
    expect(renderDuration(0.999)).toBe("0common.duration_second_short");
  });

  it("should return only seconds for durations less than a minute", () => {
    expect(renderDuration(5)).toBe("5common.duration_second_short");
    expect(renderDuration(59)).toBe("59common.duration_second_short");
  });

  it("should return only minutes for durations exactly a minute", () => {
    expect(renderDuration(60)).toBe("1common.duration_minute_short");
  });

  it("should return minutes and seconds for durations over a minute", () => {
    expect(renderDuration(65)).toBe(
      "1common.duration_minute_short 5common.duration_second_short",
    );
    expect(renderDuration(120)).toBe("2common.duration_minute_short");
    expect(renderDuration(125)).toBe(
      "2common.duration_minute_short 5common.duration_second_short",
    );
  });

  it("should return only hours for durations exactly an hour", () => {
    expect(renderDuration(3600)).toBe("1common.duration_hour_short");
  });

  it("should return hours and minutes for durations over an hour", () => {
    expect(renderDuration(3660)).toBe(
      "1common.duration_hour_short 1common.duration_minute_short",
    );
    expect(renderDuration(7200)).toBe("2common.duration_hour_short");
    expect(renderDuration(7260)).toBe(
      "2common.duration_hour_short 1common.duration_minute_short",
    );
  });

  it("should return hours, minutes, and seconds for full durations", () => {
    expect(renderDuration(3665)).toBe(
      "1common.duration_hour_short 1common.duration_minute_short 5common.duration_second_short",
    );
    expect(renderDuration(93784)).toBe(
      "26common.duration_hour_short 3common.duration_minute_short 4common.duration_second_short",
    ); // 1 day, 2 hours, 3 minutes, 4 seconds
  });

  it("should handle large durations correctly", () => {
    expect(renderDuration(360000)).toBe("100common.duration_hour_short");
    expect(renderDuration(360000 + 1234)).toBe(
      "100common.duration_hour_short 20common.duration_minute_short 34common.duration_second_short",
    );
  });

  it('should return "0s" for negative input', () => {
    expect(renderDuration(-10)).toBe("0common.duration_second_short");
    expect(renderDuration(-0.1)).toBe("0common.duration_second_short");
  });
});

describe("renderTroops", () => {
  it('should return "0" for 0 troops', () => {
    expect(renderTroops(0)).toBe("0");
  });

  it('should return "0" for troops less than 10 (which become less than 1 when divided by 10)', () => {
    expect(renderTroops(5)).toBe("0"); // 0.5 -> floor(0.5) = 0
    expect(renderTroops(9)).toBe("0"); // 0.9 -> floor(0.9) = 0
  });

  it("should correctly render troops for exact multiples of 10 up to 1000", () => {
    expect(renderTroops(10)).toBe("1");
    expect(renderTroops(100)).toBe("10");
    expect(renderTroops(990)).toBe("99");
  });

  it("should correctly render troops using K suffix", () => {
    expect(renderTroops(10000)).toBe("1.00K"); // 1000 -> 1.00K
    expect(renderTroops(12340)).toBe("1.23K"); // 1234 -> 1.23K
    expect(renderTroops(99990)).toBe("9.99K"); // 9999 -> 9.99K
    expect(renderTroops(100000)).toBe("10.0K"); // 10000 -> 10K
    expect(renderTroops(999990)).toBe("99.9K"); // 99999 -> 99.9K
  });

  it("should correctly render troops using M suffix", () => {
    expect(renderTroops(1_000_000)).toBe("100K"); // 100_000 -> 100K
    expect(renderTroops(10_000_000)).toBe("1.00M"); // 1_000_000 -> 1.00M
    expect(renderTroops(12_340_000)).toBe("1.23M"); // 1_234_000 -> 1.2M
    expect(renderTroops(99_990_000)).toBe("9.99M"); // 9_999_000 -> 9.9M
    expect(renderTroops(100_000_000)).toBe("10.0M"); // 10_000_000 -> 10.0M
  });

  it('should return "0" for negative troops', () => {
    expect(renderTroops(-1)).toBe("0");
    expect(renderTroops(-100)).toBe("0");
  });
});

describe("formatPercentage", () => {
  it('should format 0 as "0.0%"', () => {
    expect(formatPercentage(0)).toBe("0.0%");
  });

  it("should format a positive decimal as a percentage with one decimal place", () => {
    expect(formatPercentage(0.5)).toBe("50.0%");
    expect(formatPercentage(0.123)).toBe("12.3%");
    expect(formatPercentage(0.12345)).toBe("12.3%");
    expect(formatPercentage(0.999)).toBe("99.9%");
    expect(formatPercentage(0.9999)).toBe("100.0%"); // Rounds up
    expect(formatPercentage(1)).toBe("100.0%");
    expect(formatPercentage(1.23)).toBe("123.0%");
  });

  it("should format a negative decimal as a percentage with one decimal place", () => {
    expect(formatPercentage(-0.1)).toBe("-10.0%");
    expect(formatPercentage(-0.005)).toBe("-0.5%");
  });

  it('should handle NaN input by returning "0%"', () => {
    expect(formatPercentage(NaN)).toBe("0%");
  });

  it("should handle Infinity input", () => {
    expect(formatPercentage(Infinity)).toBe("Infinity%");
  });

  it("should handle -Infinity input", () => {
    expect(formatPercentage(-Infinity)).toBe("-Infinity%");
  });
});

describe("formatKeyForDisplay", () => {
  it("should return an empty string for empty input", () => {
    expect(formatKeyForDisplay("")).toBe("");
  });

  it('should format a single space as "Space"', () => {
    expect(formatKeyForDisplay(" ")).toBe("Space");
  });

  it('should format "Space" key as "Space"', () => {
    expect(formatKeyForDisplay("Space")).toBe("Space");
  });

  it('should strip "Digit" prefix for digit keys', () => {
    expect(formatKeyForDisplay("Digit1")).toBe("1");
    expect(formatKeyForDisplay("Digit5")).toBe("5");
    expect(formatKeyForDisplay("Digit0")).toBe("0");
  });

  it('should strip "Key" prefix for uppercase letter keys', () => {
    expect(formatKeyForDisplay("KeyA")).toBe("A");
    expect(formatKeyForDisplay("KeyZ")).toBe("Z");
    expect(formatKeyForDisplay("KeyB")).toBe("B");
  });

  it("should capitalize the first letter for other keys (e.g., ArrowUp, Enter)", () => {
    expect(formatKeyForDisplay("arrowUp")).toBe("ArrowUp");
    expect(formatKeyForDisplay("arrowleft")).toBe("Arrowleft");
    expect(formatKeyForDisplay("enter")).toBe("Enter");
    expect(formatKeyForDisplay("escape")).toBe("Escape");
  });

  it('should handle "Shift+" prefix correctly with digit keys', () => {
    expect(formatKeyForDisplay("Shift+Digit1")).toBe("Shift+1");
    expect(formatKeyForDisplay("Shift+Digit9")).toBe("Shift+9");
  });

  it('should handle "Shift+" prefix correctly with letter keys', () => {
    expect(formatKeyForDisplay("Shift+KeyA")).toBe("Shift+A");
    expect(formatKeyForDisplay("Shift+KeyZ")).toBe("Shift+Z");
  });

  it('should handle "Shift+" prefix correctly with "Space" key', () => {
    expect(formatKeyForDisplay("Shift+Space")).toBe("Shift+Space");
    expect(formatKeyForDisplay("Shift+ ")).toBe("Shift+Space");
  });

  it('should handle "Shift+" prefix correctly with other keys', () => {
    expect(formatKeyForDisplay("Shift+ArrowUp")).toBe("Shift+ArrowUp");
    expect(formatKeyForDisplay("Shift+Enter")).toBe("Shift+Enter");
  });

  it("should return the input as is if no specific formatting rules apply and it is already capitalized", () => {
    expect(formatKeyForDisplay("F1")).toBe("F1");
    expect(formatKeyForDisplay("Backspace")).toBe("Backspace");
  });

  it('should handle keys with "key" or "digit" in lowercase by capitalizing the first letter only', () => {
    expect(formatKeyForDisplay("keya")).toBe("Keya");
    expect(formatKeyForDisplay("digit1")).toBe("Digit1");
    expect(formatKeyForDisplay("controlLeft")).toBe("ControlLeft");
  });
});
