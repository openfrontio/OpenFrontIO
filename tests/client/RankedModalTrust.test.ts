import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getUserMe = vi.fn<() => Promise<UserMeResponse | false>>();

vi.mock("../../src/client/Api", () => ({
  getUserMe: () => getUserMe(),
}));

vi.mock("../../src/client/Auth", () => ({
  userAuth: vi.fn(async () => false),
}));

vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: {
    isOnCrazyGames: vi.fn(() => false),
    getUserProfile: vi.fn(async () => null),
  },
}));

vi.mock("../../src/client/TerrainMapFileLoader", () => ({
  terrainMapFileLoader: { getMapData: vi.fn() },
}));

vi.mock("../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
  getMapName: vi.fn(),
  getModifierLabels: vi.fn(() => []),
}));

import { RankedModal } from "../../src/client/components/RankedModal";

function userMe(trustTier?: "trusted" | "untrusted" | null): UserMeResponse {
  return {
    user: { email: "player@example.com" },
    player: {
      publicId: "player-id",
      adfree: false,
      unlimitedRanked: false,
      canCreatePublicLobbies: false,
      achievements: { singleplayerMap: [], player: [] },
      friends: [],
      subscription: null,
      trustTier,
    },
  } as unknown as UserMeResponse;
}

describe("RankedModal trust lock", () => {
  let modal: RankedModal;

  beforeEach(() => {
    getUserMe.mockReset();
    modal = new RankedModal();
    document.body.appendChild(modal);
  });

  afterEach(() => {
    modal.remove();
  });

  async function openWith(
    response: UserMeResponse | false,
  ): Promise<HTMLElement[]> {
    getUserMe.mockReturnValue(Promise.resolve(response));
    modal.open();
    await vi.waitFor(() => expect(getUserMe).toHaveBeenCalled());
    await vi.waitFor(async () => {
      await modal.updateComplete;
      expect((modal as unknown as { loading: boolean }).loading).toBe(false);
    });
    await modal.updateComplete;
    return [...modal.querySelectorAll<HTMLElement>("[data-trust]")];
  }

  it("shows a green open lock on both ranked cards for a trusted account", async () => {
    const locks = await openWith(userMe("trusted"));
    expect(locks).toHaveLength(2);
    for (const lock of locks) {
      expect(lock.dataset.trust).toBe("unlocked");
      expect(lock.classList.contains("text-green-400")).toBe(true);
    }
  });

  it.each(["untrusted", null, undefined] as const)(
    "shows a red closed lock when the tier is %s",
    async (tier) => {
      const locks = await openWith(userMe(tier));
      expect(locks).toHaveLength(2);
      for (const lock of locks) {
        expect(lock.dataset.trust).toBe("locked");
        expect(lock.classList.contains("text-red-400")).toBe(true);
      }
    },
  );

  it("shows a red closed lock when signed out", async () => {
    const locks = await openWith(false);
    expect(locks.map((l) => l.dataset.trust)).toEqual(["locked", "locked"]);
  });

  it("shows no lock until /users/@me answers", async () => {
    let resolve!: (value: UserMeResponse) => void;
    getUserMe.mockReturnValue(new Promise((r) => (resolve = r)));
    modal.open();
    await modal.updateComplete;
    expect(modal.querySelectorAll("[data-trust]")).toHaveLength(0);
    resolve(userMe("trusted"));
    await vi.waitFor(async () => {
      await modal.updateComplete;
      expect(modal.querySelectorAll("[data-trust]")).toHaveLength(2);
    });
  });

  it("shows no lock when /users/@me fails", async () => {
    getUserMe.mockRejectedValue(new Error("network"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    modal.open();
    await vi.waitFor(async () => {
      await modal.updateComplete;
      expect((modal as unknown as { loading: boolean }).loading).toBe(false);
    });
    await modal.updateComplete;
    expect(modal.querySelectorAll("[data-trust]")).toHaveLength(0);
    warn.mockRestore();
  });
});
