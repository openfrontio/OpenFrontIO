import { beforeEach, describe, expect, it, vi } from "vitest";

const { claimReward, invalidateUserMe } = vi.hoisted(() => ({
  claimReward: vi.fn(),
  invalidateUserMe: vi.fn(),
}));
vi.mock("../../src/client/Api", () => ({ claimReward, invalidateUserMe }));

import { claimRewards } from "../../src/client/RewardClaims";

const balances = (soft: number, hard: number) => ({
  currency: { soft, hard },
});

// Claimable rewards, by id.
const rewards = (...ids: string[]) => ids.map((id) => ({ id }));

describe("claimRewards", () => {
  beforeEach(() => {
    claimReward.mockReset();
    invalidateUserMe.mockReset();
  });

  it("claims each in order and keeps the last balances", async () => {
    claimReward
      .mockResolvedValueOnce(balances(100, 0))
      .mockResolvedValueOnce(balances(200, 25));
    const run = await claimRewards(rewards("a", "b"));
    expect(claimReward.mock.calls.map((c) => c[0])).toEqual(["a", "b"]);
    expect(run).toEqual({
      claimedIds: ["a", "b"],
      creditedIds: ["a", "b"],
      currency: { soft: 200, hard: 25 },
      held: [],
      failed: false,
    });
    expect(invalidateUserMe).toHaveBeenCalledTimes(1);
  });

  it("counts not_found as claimed, but not as credited", async () => {
    claimReward
      .mockResolvedValueOnce("not_found")
      .mockResolvedValueOnce(balances(300, 0));
    const run = await claimRewards(rewards("gone", "b"));
    expect(run.claimedIds).toEqual(["gone", "b"]);
    expect(run.creditedIds).toEqual(["b"]);
    expect(run.currency).toEqual({ soft: 300, hard: 0 });
  });

  it("stops at the first failure, keeping what went through", async () => {
    claimReward
      .mockResolvedValueOnce(balances(100, 0))
      .mockResolvedValueOnce(false);
    const run = await claimRewards(rewards("a", "b", "c"));
    expect(claimReward).toHaveBeenCalledTimes(2);
    expect(run.failed).toBe(true);
    expect(run.claimedIds).toEqual(["a"]);
    expect(invalidateUserMe).toHaveBeenCalledTimes(1);
  });

  it("never claims a held reward, nor counts it", async () => {
    claimReward.mockResolvedValue(balances(100, 0));
    const run = await claimRewards([
      { id: "a" },
      { id: "pu", held: "trust" },
      { id: "odd", held: "unknown" },
      { id: "b" },
    ]);
    expect(claimReward.mock.calls.map((c) => c[0])).toEqual(["a", "b"]);
    expect(run).toEqual({
      claimedIds: ["a", "b"],
      creditedIds: ["a", "b"],
      currency: { soft: 100, hard: 0 },
      held: [],
      failed: false,
    });
  });

  it("claims nothing, and keeps the cache, when every reward is held", async () => {
    const run = await claimRewards([{ id: "pu", held: "trust" }]);
    expect(claimReward).not.toHaveBeenCalled();
    expect(run.claimedIds).toEqual([]);
    expect(run.failed).toBe(false);
    expect(invalidateUserMe).not.toHaveBeenCalled();
  });

  it("treats a { held } answer (held after all) as not claimed, and moves on", async () => {
    claimReward
      .mockResolvedValueOnce({ held: "trust" })
      .mockResolvedValueOnce(balances(300, 0));
    const run = await claimRewards(rewards("held", "b"));
    expect(claimReward.mock.calls.map((c) => c[0])).toEqual(["held", "b"]);
    expect(run).toEqual({
      claimedIds: ["b"],
      creditedIds: ["b"],
      currency: { soft: 300, hard: 0 },
      held: [{ id: "held", held: "trust" }],
      failed: false,
    });
    expect(invalidateUserMe).toHaveBeenCalledTimes(1);
  });

  it("drops the cached account when the only answer is { held }", async () => {
    claimReward.mockResolvedValueOnce({ held: "region" });
    const run = await claimRewards(rewards("held"));
    expect(run.claimedIds).toEqual([]);
    expect(run.held).toEqual([{ id: "held", held: "region" }]);
    expect(run.failed).toBe(false);
    // /users/@me doesn't know the hold yet: the next read must.
    expect(invalidateUserMe).toHaveBeenCalledTimes(1);
  });

  it("still stops at a malformed { held } answer", async () => {
    claimReward.mockResolvedValueOnce({ held: "" });
    const run = await claimRewards(rewards("a", "b"));
    expect(claimReward).toHaveBeenCalledTimes(1);
    expect(run.failed).toBe(true);
    expect(run.held).toEqual([]);
    expect(invalidateUserMe).not.toHaveBeenCalled();
  });

  it("stops before the next claim once its caller has gone", async () => {
    let gone = false;
    const claim = vi.fn(async () => {
      gone = true;
      return balances(100, 0);
    });
    const run = await claimRewards(rewards("a", "b"), {
      claim,
      stopped: () => gone,
    });
    expect(claim).toHaveBeenCalledTimes(1);
    expect(run.claimedIds).toEqual(["a"]);
    expect(run.failed).toBe(false);
    expect(claimReward).not.toHaveBeenCalled();
  });

  it("claims nothing, and keeps the cache, for an empty list", async () => {
    const run = await claimRewards([]);
    expect(run.claimedIds).toEqual([]);
    expect(invalidateUserMe).not.toHaveBeenCalled();
  });
});
