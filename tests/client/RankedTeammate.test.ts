import { beforeEach, describe, expect, it } from "vitest";
import {
  getRankedTeammate,
  setRankedTeammate,
} from "../../src/client/RankedTeammate";

describe("RankedTeammate", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips a teammate id", () => {
    setRankedTeammate("kuvf0w1W");
    expect(getRankedTeammate()).toBe("kuvf0w1W");
  });

  it("returns null when nothing is stored", () => {
    expect(getRankedTeammate()).toBeNull();
  });

  it("treats an empty value as no teammate, so callers only test for null", () => {
    setRankedTeammate("kuvf0w1W");
    setRankedTeammate("");
    expect(getRankedTeammate()).toBeNull();
  });

  it("survives a reload (the value lives in storage, not memory)", () => {
    setRankedTeammate("kuvf0w1W");
    // A reload keeps localStorage but drops every module-level value; reading
    // again is exactly what the ranked screen and the queue both do.
    expect(getRankedTeammate()).toBe("kuvf0w1W");
    expect(localStorage.getItem("ranked-2v2-teammate")).toBe("kuvf0w1W");
  });
});
