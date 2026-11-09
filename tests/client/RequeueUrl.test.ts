import { RankedType } from "@openfront/engine-api/game/GameTypes";
import { describe, expect, it, vi } from "vitest";
import {
  consumeRequeueUrl,
  requeueModeForRankedType,
  requeueModeFromParam,
} from "../../src/client/RequeueUrl";

const loc = (search: string, hash = "") => ({ search, pathname: "/", hash });

describe("requeueModeFromParam", () => {
  it.each([
    ["", "1v1"],
    ["2v2", "2v2"],
    ["clanwars", "clanwars"],
    ["bogus", "1v1"],
  ] as const)("maps %j to %s", (param, mode) => {
    expect(requeueModeFromParam(param)).toBe(mode);
  });

  it("does not requeue ranked FFA, whose queue is gone", () => {
    expect(requeueModeFromParam("ffa")).toBeNull();
  });
});

describe("consumeRequeueUrl", () => {
  it("leaves a URL without the param alone", () => {
    const replace = vi.fn();
    expect(consumeRequeueUrl(loc("?foo=1"), replace)).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it("?requeue=ffa opens no matchmaking, not 1v1, and still strips the param", () => {
    const replace = vi.fn();
    expect(
      consumeRequeueUrl(loc("?requeue=ffa&foo=1", "#x"), replace),
    ).toBeNull();
    expect(replace).toHaveBeenCalledWith("/?foo=1#x");
  });

  it("keeps a bare ?requeue as 1v1", () => {
    const replace = vi.fn();
    expect(consumeRequeueUrl(loc("?requeue"), replace)).toBe("1v1");
    expect(replace).toHaveBeenCalledWith("/");
  });
});

describe("requeueModeForRankedType", () => {
  it.each([
    [RankedType.OneVOne, "1v1"],
    [RankedType.TwoVTwo, "2v2"],
    [RankedType.ClanWars, "clanwars"],
  ] as const)("requeues %s as %s", (rankedType, mode) => {
    expect(requeueModeForRankedType(rankedType)).toBe(mode);
  });

  it("offers no requeue for ranked FFA or an unranked game", () => {
    expect(requeueModeForRankedType(RankedType.FreeForAll)).toBeNull();
    expect(requeueModeForRankedType(undefined)).toBeNull();
  });
});
