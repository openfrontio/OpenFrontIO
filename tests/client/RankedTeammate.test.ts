import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRankedTeammate,
  setRankedTeammate,
} from "../../src/client/RankedTeammate";

const KEY = "ranked-2v2-teammate";

describe("RankedTeammate", () => {
  beforeEach(() => {
    localStorage.clear();
    // Clear the module's in-memory mirror between tests.
    setRankedTeammate("");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("round-trips a teammate id", () => {
    setRankedTeammate("kuvf0w1W");
    expect(getRankedTeammate()).toBe("kuvf0w1W");
  });

  it("returns null when nothing is stored", () => {
    expect(getRankedTeammate()).toBeNull();
  });

  it("clearing removes the stored key", () => {
    setRankedTeammate("kuvf0w1W");
    setRankedTeammate("");
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(getRankedTeammate()).toBeNull();
  });

  it("normalises a stored empty string to null", () => {
    // Set directly: setRankedTeammate("") removes the key, so this is the only
    // way to exercise a persisted empty value.
    localStorage.setItem(KEY, "");
    expect(getRankedTeammate()).toBeNull();
  });

  it("survives a reload (the value lives in storage, not memory)", () => {
    setRankedTeammate("kuvf0w1W");
    expect(getRankedTeammate()).toBe("kuvf0w1W");
    expect(localStorage.getItem(KEY)).toBe("kuvf0w1W");
  });

  describe("self-reference", () => {
    it("rejects and clears a stored id belonging to the current player", () => {
      // Two accounts sharing a browser: the previous player's id is this
      // player's own id, and queueing with it would mean waiting on yourself.
      setRankedTeammate("me123");
      expect(getRankedTeammate("me123")).toBeNull();
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    it("keeps a teammate that is someone else", () => {
      setRankedTeammate("friend1");
      expect(getRankedTeammate("me123")).toBe("friend1");
    });

    it("ignores the check when the own id is unknown", () => {
      setRankedTeammate("friend1");
      expect(getRankedTeammate(null)).toBe("friend1");
      expect(getRankedTeammate(undefined)).toBe("friend1");
    });
  });

  it("keeps the value for the page when storage is unavailable", () => {
    // Private mode: writes throw and reads return nothing, so without the
    // in-memory mirror the player would silently queue solo.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    setRankedTeammate("kuvf0w1W");
    expect(getRankedTeammate()).toBe("kuvf0w1W");
  });
});
