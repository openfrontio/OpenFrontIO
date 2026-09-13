import { afterEach, describe, expect, it, vi } from "vitest";
import "../../../../src/client/hud/layers/WinModal";
import type { WinModal } from "../../../../src/client/hud/layers/WinModal";
import { SendWinnerEvent } from "../../../../src/client/Transport";
import type { GameView } from "../../../../src/client/view";
import { EventBus } from "../../../../src/core/EventBus";
import { GameUpdateType } from "../../../../src/core/game/GameUpdates";

vi.mock("../../../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
  getGamesPlayed: vi.fn(() => 10),
  isInIframe: vi.fn(() => false),
  homeHref: vi.fn(() => "/"),
  TUTORIAL_VIDEO_URL: "https://example.com/tutorial",
}));

vi.mock("../../../../src/client/Api", () => ({
  getUserMe: vi.fn(async () => null),
}));

vi.mock("../../../../src/client/Cosmetics", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../src/client/Cosmetics")
  >()),
  fetchCosmetics: vi.fn(async () => null),
  resolveCosmetics: vi.fn(() => []),
}));

vi.mock("../../../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: {
    happytime: vi.fn(),
    requestAd: vi.fn(),
    gameplayStop: vi.fn(),
  },
}));

import { crazyGamesSDK } from "../../../../src/client/CrazyGamesSDK";

type Winner = ["team", string] | ["player", string] | undefined;

function makeGame(opts: {
  winner: Winner;
  myTeam?: string;
  myClientID?: string;
  winnerPlayer?: {
    isPlayer: () => boolean;
    clientID: () => string | null;
    displayName: () => string;
  };
}): GameView {
  const winUpdate = { winner: opts.winner, allPlayersStats: {} };
  return {
    myPlayer: () => ({
      isAlive: () => true,
      hasSpawned: () => true,
      team: () => opts.myTeam ?? null,
      clientID: () => opts.myClientID ?? null,
    }),
    inSpawnPhase: () => false,
    updatesSinceLastTick: () => ({ [GameUpdateType.Win]: [winUpdate] }),
    playerByClientID: () => opts.winnerPlayer,
    config: () => ({ gameConfig: () => ({ rankedType: undefined }) }),
  } as unknown as GameView;
}

describe("WinModal tick win handling", () => {
  let modal: WinModal | undefined;

  function setup(game: GameView) {
    const eventBus = new EventBus();
    const winnerEvents: SendWinnerEvent[] = [];
    eventBus.on(SendWinnerEvent, (e) => winnerEvents.push(e));
    modal = document.createElement("win-modal") as WinModal;
    modal.game = game;
    modal.eventBus = eventBus;
    return winnerEvents;
  }

  afterEach(() => {
    modal?.remove();
    modal = undefined;
    vi.clearAllMocks();
  });

  it("emits the winner and celebrates when my team wins", async () => {
    const events = setup(
      makeGame({ winner: ["team", "Blue"], myTeam: "Blue" }),
    );
    modal!.tick();

    expect(events).toHaveLength(1);
    expect(events[0].winner).toEqual(["team", "Blue"]);
    expect(crazyGamesSDK.happytime).toHaveBeenCalled();
    await vi.waitFor(() => expect(modal!.isVisible).toBe(true));
  });

  it("emits the winner without celebrating when another team wins", async () => {
    const events = setup(makeGame({ winner: ["team", "Red"], myTeam: "Blue" }));
    modal!.tick();

    expect(events).toHaveLength(1);
    expect(events[0].winner).toEqual(["team", "Red"]);
    expect(crazyGamesSDK.happytime).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(modal!.isVisible).toBe(true));
  });

  it("emits a player winner resolved through playerByClientID", async () => {
    const events = setup(
      makeGame({
        winner: ["player", "winner-client"],
        myClientID: "my-client",
        winnerPlayer: {
          isPlayer: () => true,
          clientID: () => "winner-client",
          displayName: () => "Bob",
        },
      }),
    );
    modal!.tick();

    expect(events).toHaveLength(1);
    expect(events[0].winner).toEqual(["player", "winner-client"]);
    expect(crazyGamesSDK.happytime).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(modal!.isVisible).toBe(true));
  });

  it("celebrates when the winning client is me", async () => {
    setup(
      makeGame({
        winner: ["player", "my-client"],
        myClientID: "my-client",
        winnerPlayer: {
          isPlayer: () => true,
          clientID: () => "my-client",
          displayName: () => "Me",
        },
      }),
    );
    modal!.tick();

    expect(crazyGamesSDK.happytime).toHaveBeenCalled();
    await vi.waitFor(() => expect(modal!.isVisible).toBe(true));
  });

  it("emits a winnerless result when the match is cancelled", async () => {
    const events = setup(makeGame({ winner: undefined }));
    modal!.tick();

    expect(events).toHaveLength(1);
    expect(events[0].winner).toBeUndefined();
    await vi.waitFor(() => expect(modal!.isVisible).toBe(true));
  });

  it("ignores a player win whose winner is not a known player", () => {
    const events = setup(
      makeGame({ winner: ["player", "gone"], winnerPlayer: undefined }),
    );
    modal!.tick();

    expect(events).toHaveLength(0);
    expect(modal!.isVisible).toBe(false);
  });
});
