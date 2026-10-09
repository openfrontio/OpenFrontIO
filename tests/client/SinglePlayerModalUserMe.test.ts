import { Difficulty, GameMapType } from "@openfront/engine-api/game/GameTypes";
import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Cosmetics", () => ({
  getPlayerCosmetics: vi.fn(async () => ({})),
  prewarmCosmetics: vi.fn(),
}));

vi.mock("../../src/client/TerrainMapFileLoader", () => ({
  terrainMapFileLoader: { getMapData: vi.fn() },
}));

// The broadcast the modal missed, under the test's control.
const broadcast = vi.hoisted(() => ({
  last: null as { response: UserMeResponse | false } | null,
}));
vi.mock("../../src/client/UserMeBroadcast", () => ({
  lastUserMeResponse: () => broadcast.last,
}));

// The map picker's cards watch their own visibility; jsdom has no observer.
vi.stubGlobal(
  "IntersectionObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

// Side-effect import so the custom element registers (a type-only import
// would be elided and createElement would return an inert element).
import "../../src/client/SinglePlayerModal";

function userMe(): UserMeResponse {
  return {
    user: {},
    player: {
      achievements: {
        singleplayerMap: [
          { mapName: GameMapType.World, difficulty: Difficulty.Hard },
        ],
      },
    },
  } as unknown as UserMeResponse;
}

afterEach(() => {
  broadcast.last = null;
  document.body.innerHTML = "";
});

describe("SinglePlayerModal and userMeResponse", () => {
  it("picks up a broadcast that went out before it loaded", () => {
    broadcast.last = { response: userMe() };
    const modal = document.createElement("single-player-modal") as any;
    document.body.appendChild(modal);

    expect(modal.mapWins.get(GameMapType.World)).toEqual(
      new Set([Difficulty.Hard]),
    );
  });

  it("starts empty before the first broadcast", () => {
    const modal = document.createElement("single-player-modal") as any;
    document.body.appendChild(modal);

    expect(modal.mapWins.size).toBe(0);
  });
});
