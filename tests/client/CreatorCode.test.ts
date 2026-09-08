import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizeCreatorCodeInput,
  PENDING_CREATOR_CODE_KEY,
  resumePendingCreatorCode,
  stashPendingCreatorCode,
  takePendingCreatorCode,
} from "../../src/client/CreatorCode";

beforeEach(() => {
  localStorage.clear();
});

describe("pending creator code stash", () => {
  it("stashes and takes a code, consumed once", () => {
    stashPendingCreatorCode("LEWIS");
    expect(takePendingCreatorCode()).toBe("LEWIS");
    expect(takePendingCreatorCode()).toBeNull();
  });

  it("removes the storage entry as part of the first take (consume-on-read)", () => {
    stashPendingCreatorCode("LEWIS");
    takePendingCreatorCode();
    expect(localStorage.getItem(PENDING_CREATOR_CODE_KEY)).toBeNull();
  });

  it("discards a stash older than the TTL, and still consumes it", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-05T12:00:00Z"));
      stashPendingCreatorCode("LEWIS");

      // One millisecond past the 7-day TTL.
      vi.setSystemTime(new Date("2026-08-12T12:00:00.001Z"));
      expect(takePendingCreatorCode()).toBeNull();

      // Consumed even when rejected -- otherwise a stale entry is re-read
      // and re-rejected on every page load forever.
      expect(localStorage.getItem(PENDING_CREATOR_CODE_KEY)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("still resumes a stash inside the TTL", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-05T12:00:00Z"));
      stashPendingCreatorCode("LEWIS");

      vi.setSystemTime(new Date("2026-08-12T11:59:59Z"));
      expect(takePendingCreatorCode()).toBe("LEWIS");
    } finally {
      vi.useRealTimers();
    }
  });

  it("discards a stash with no timestamp rather than guessing its age", () => {
    localStorage.setItem(
      PENDING_CREATOR_CODE_KEY,
      JSON.stringify({ code: "LEWIS" }),
    );
    expect(takePendingCreatorCode()).toBeNull();
    expect(localStorage.getItem(PENDING_CREATOR_CODE_KEY)).toBeNull();
  });

  it("discards a stash with a non-numeric stashedAt rather than guessing its age", () => {
    localStorage.setItem(
      PENDING_CREATOR_CODE_KEY,
      JSON.stringify({ code: "LEWIS", stashedAt: "not-a-number" }),
    );
    expect(takePendingCreatorCode()).toBeNull();
  });

  it("returns null for malformed JSON instead of throwing", () => {
    localStorage.setItem(PENDING_CREATOR_CODE_KEY, "{not json");
    expect(() => takePendingCreatorCode()).not.toThrow();
    expect(takePendingCreatorCode()).toBeNull();
  });

  it("returns null for a legacy bare-string value instead of throwing", () => {
    // A pre-migration format (or any other unquoted/non-JSON string) must
    // not crash every subsequent page load for whoever still has one.
    localStorage.setItem(PENDING_CREATOR_CODE_KEY, "LEWIS");
    expect(() => takePendingCreatorCode()).not.toThrow();
    expect(takePendingCreatorCode()).toBeNull();
  });

  it("returns null when nothing is stashed", () => {
    expect(takePendingCreatorCode()).toBeNull();
  });
});

describe("normalizeCreatorCodeInput", () => {
  it("trims and uppercases", () => {
    expect(normalizeCreatorCodeInput(" lewis ")).toBe("LEWIS");
  });

  it("is a no-op on an already-canonical code", () => {
    expect(normalizeCreatorCodeInput("LEWIS")).toBe("LEWIS");
  });

  it("accepts digits, underscore, and hyphen", () => {
    expect(normalizeCreatorCodeInput("a_b-9")).toBe("A_B-9");
  });

  it("rejects a code shorter than 3 characters", () => {
    expect(normalizeCreatorCodeInput("ab")).toBeNull();
  });

  it("accepts the 3-character floor", () => {
    expect(normalizeCreatorCodeInput("abc")).toBe("ABC");
  });

  it("rejects a code longer than 22 characters", () => {
    expect(normalizeCreatorCodeInput("a".repeat(23))).toBeNull();
  });

  it("accepts the 22-character ceiling", () => {
    expect(normalizeCreatorCodeInput("a".repeat(22))).toBe("A".repeat(22));
  });

  it("rejects a code containing a non-ASCII letter", () => {
    // "père" uppercases to "PÈRE" -- "È" is outside [A-Z0-9_-].
    expect(normalizeCreatorCodeInput("père")).toBeNull();
  });

  it("rejects a code whose uppercase expansion pushes it past 22 characters", () => {
    // "ß".toUpperCase() === "SS": each character doubles in length, so 12
    // of them (12 chars raw) expands to 24 uppercase characters -- over the
    // 22-char ceiling even though the raw input looked short enough.
    const raw = "ß".repeat(12);
    expect(raw.length).toBe(12);
    expect(normalizeCreatorCodeInput(raw)).toBeNull();
  });

  it("rejects an empty or whitespace-only string", () => {
    expect(normalizeCreatorCodeInput("")).toBeNull();
    expect(normalizeCreatorCodeInput("   ")).toBeNull();
  });

  it("rejects internal whitespace", () => {
    expect(normalizeCreatorCodeInput("le wis")).toBeNull();
  });
});

describe("resumePendingCreatorCode", () => {
  it("returns true and calls back with the code when a valid stash exists", () => {
    stashPendingCreatorCode("LEWIS");
    const open = vi.fn();

    const resumed = resumePendingCreatorCode(open);

    expect(resumed).toBe(true);
    expect(open).toHaveBeenCalledWith("LEWIS");
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("consumes the stash so a second call returns false", () => {
    stashPendingCreatorCode("LEWIS");
    const open = vi.fn();

    resumePendingCreatorCode(open);
    const second = resumePendingCreatorCode(open);

    expect(second).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("returns false and does not call back when there is no pending code", () => {
    const open = vi.fn();

    const resumed = resumePendingCreatorCode(open);

    expect(resumed).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it("returns false and does not call back when the stash expired", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-05T12:00:00Z"));
      stashPendingCreatorCode("LEWIS");
      vi.setSystemTime(new Date("2026-08-12T12:00:00.001Z"));

      const open = vi.fn();
      const resumed = resumePendingCreatorCode(open);

      expect(resumed).toBe(false);
      expect(open).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
