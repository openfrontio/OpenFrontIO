import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ownHiddenLevelBadge,
  ownHiddenLevelBadgeFrom,
  refreshOwnHiddenLevelBadge,
} from "../../src/client/OwnLevelBadge";

const getUserMe = vi.hoisted(() =>
  vi.fn<() => Promise<UserMeResponse | false>>(async () => false),
);
vi.mock("../../src/client/Api", () => ({ getUserMe }));

const progress = {
  prestige: 10,
  level: 100,
  xpInLevel: 0,
  xpForNext: 0,
  lifetimeXp: 5_000_000,
  legend: true,
  canPrestige: false,
};
function me(player: Record<string, unknown>): UserMeResponse {
  return {
    user: {},
    player: { publicId: "me-pub", ...player },
  } as unknown as UserMeResponse;
}

describe("ownHiddenLevelBadgeFrom", () => {
  it("is the player's own badge while they hide their level", () => {
    expect(
      ownHiddenLevelBadgeFrom(me({ progress, levelHidden: true })),
    ).toEqual({ level: 100, prestige: 10, legend: true });
  });

  it("is nothing while the level is shown (the roster carries it)", () => {
    expect(
      ownHiddenLevelBadgeFrom(me({ progress, levelHidden: false })),
    ).toBeUndefined();
    // An older API without the setting: shown.
    expect(ownHiddenLevelBadgeFrom(me({ progress }))).toBeUndefined();
  });

  it("is nothing without progress or signed out", () => {
    expect(ownHiddenLevelBadgeFrom(me({ levelHidden: true }))).toBeUndefined();
    expect(ownHiddenLevelBadgeFrom(false)).toBeUndefined();
  });
});

describe("refreshOwnHiddenLevelBadge", () => {
  beforeEach(() => {
    document.dispatchEvent(new Event("session-cleared"));
    getUserMe.mockReset();
  });

  it("caches the answer for synchronous readers", async () => {
    getUserMe.mockResolvedValue(me({ progress, levelHidden: true }));
    expect(ownHiddenLevelBadge()).toBeUndefined();
    await refreshOwnHiddenLevelBadge();
    expect(ownHiddenLevelBadge()).toEqual({
      level: 100,
      prestige: 10,
      legend: true,
    });
  });

  it("drops it when the session is cleared", async () => {
    getUserMe.mockResolvedValue(me({ progress, levelHidden: true }));
    await refreshOwnHiddenLevelBadge();
    document.dispatchEvent(new Event("session-cleared"));
    expect(ownHiddenLevelBadge()).toBeUndefined();
  });
});
