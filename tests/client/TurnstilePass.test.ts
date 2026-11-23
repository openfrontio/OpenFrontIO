import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearTurnstilePass,
  hasValidTurnstilePass,
  recordTurnstilePass,
  TURNSTILE_PASS_TTL_MS,
  turnstilePassKey,
} from "../../src/client/TurnstilePass";

describe("TurnstilePass", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("formats storage keys as turnstilePass:<persistentId>", () => {
    expect(turnstilePassKey("abc-123")).toBe("turnstilePass:abc-123");
  });

  it("returns false when no pass is stored", () => {
    expect(hasValidTurnstilePass("user-1", 1_000)).toBe(false);
  });

  it("records and validates passes within TTL, including timestamp 0", () => {
    const start = 1_700_000_000_000;
    recordTurnstilePass("user-1", start);
    expect(localStorage.getItem(turnstilePassKey("user-1"))).toBe(
      String(start),
    );
    expect(hasValidTurnstilePass("user-1", start)).toBe(true);
    expect(hasValidTurnstilePass("user-1", start + 60_000)).toBe(true);

    recordTurnstilePass("user-zero", 0);
    expect(hasValidTurnstilePass("user-zero", 0)).toBe(true);
    expect(hasValidTurnstilePass("user-zero", 1_000)).toBe(true);
  });

  it("treats 6h - 1ms as valid and exact 6h as expired", () => {
    expect(TURNSTILE_PASS_TTL_MS).toBe(6 * 60 * 60 * 1000);
    const ts = 10_000;
    recordTurnstilePass("user-1", ts);

    expect(
      hasValidTurnstilePass("user-1", ts + TURNSTILE_PASS_TTL_MS - 1),
    ).toBe(true);
    expect(hasValidTurnstilePass("user-1", ts + TURNSTILE_PASS_TTL_MS)).toBe(
      false,
    );
  });

  it("clears the stored key and invalidates the pass", () => {
    recordTurnstilePass("user-1", 5_000);
    expect(hasValidTurnstilePass("user-1", 5_000)).toBe(true);

    clearTurnstilePass("user-1");
    expect(localStorage.getItem(turnstilePassKey("user-1"))).toBeNull();
    expect(hasValidTurnstilePass("user-1", 5_000)).toBe(false);
  });

  it("isolates passes per persistentId", () => {
    recordTurnstilePass("user-a", 1_000);
    recordTurnstilePass("user-b", 2_000);

    clearTurnstilePass("user-a");

    expect(hasValidTurnstilePass("user-a", 2_500)).toBe(false);
    expect(hasValidTurnstilePass("user-b", 2_500)).toBe(true);
  });

  it("rejects invalid, negative, non-finite, and future timestamps", () => {
    const key = turnstilePassKey("user-1");
    const now = 10_000;

    for (const raw of [
      "",
      "   ",
      "not-a-number",
      "-1",
      "Infinity",
      "-Infinity",
      "NaN",
      String(now + 1),
    ]) {
      localStorage.setItem(key, raw);
      expect(hasValidTurnstilePass("user-1", now)).toBe(false);
    }
  });

  it("no-ops safely when persistentId is empty", () => {
    const getSpy = vi.spyOn(Storage.prototype, "getItem");
    const setSpy = vi.spyOn(Storage.prototype, "setItem");
    const removeSpy = vi.spyOn(Storage.prototype, "removeItem");

    recordTurnstilePass("", 1_000);
    expect(hasValidTurnstilePass("", 1_000)).toBe(false);
    clearTurnstilePass("");

    expect(getSpy).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it("swallows localStorage errors gracefully on get, set, and remove", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });

    expect(() => recordTurnstilePass("user-1", 1_000)).not.toThrow();
    expect(hasValidTurnstilePass("user-1", 1_000)).toBe(false);
    expect(() => clearTurnstilePass("user-1")).not.toThrow();
  });

  it("preserves a newer pass hint when clearTurnstilePass is given an older maxTimestamp", () => {
    recordTurnstilePass("user-1", 1_000);
    // Another tab refreshes and writes a newer hint at t = 2_000.
    recordTurnstilePass("user-1", 2_000);

    clearTurnstilePass("user-1", 1_000);
    expect(hasValidTurnstilePass("user-1", 2_500)).toBe(true);

    // Clearing with maxTimestamp >= stored removes it.
    clearTurnstilePass("user-1", 2_000);
    expect(hasValidTurnstilePass("user-1", 2_500)).toBe(false);
  });
});
