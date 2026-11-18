import { describe, expect, it } from "vitest";
import { fuzzyMatch } from "../src/client/FuzzySearch";

describe("fuzzyMatch", () => {
  it("matches empty pattern against any string", () => {
    expect(fuzzyMatch("", "anything")).toBe(true);
    expect(fuzzyMatch("   ", "anything")).toBe(true);
  });

  it("matches exact substring case-insensitively", () => {
    expect(fuzzyMatch("bob", "Bob")).toBe(true);
    expect(fuzzyMatch("JIM", "Jimmy")).toBe(true);
    expect(fuzzyMatch("clan", "SuperClan")).toBe(true);
  });

  it("matches characters in order", () => {
    expect(fuzzyMatch("bf", "BelleFlipflop")).toBe(true);
    expect(fuzzyMatch("ff", "Flipflop")).toBe(true);
    expect(fuzzyMatch("op", "OpenFront")).toBe(true);
  });

  it("rejects non-matching patterns or out of order characters", () => {
    expect(fuzzyMatch("xyz", "Bob")).toBe(false);
    expect(fuzzyMatch("mj", "Jim")).toBe(false);
  });
});
