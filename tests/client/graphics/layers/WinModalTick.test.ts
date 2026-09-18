import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCosmetics } from "../../../../src/client/Cosmetics";
import "../../../../src/client/hud/layers/WinModal";
import type { WinModal } from "../../../../src/client/hud/layers/WinModal";
import { SendWinnerEvent } from "../../../../src/client/Transport";
import type { GameView } from "../../../../src/client/view";
import { EventBus } from "../../../../src/core/EventBus";
import { GameType } from "../../../../src/core/game/Game";
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

vi.mock("../../../../src/client/AchievementSignal", () => ({
  syncAchievements: vi.fn(async () => {}),
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

import { syncAchievements } from "../../../../src/client/AchievementSignal";
import { crazyGamesSDK } from "../../../../src/client/CrazyGamesSDK";

type Winner = ["team", string] | ["player", string] | undefined;

function makeGame(opts: {
  winner: Winner;
  myTeam?: string;
  myClientID?: string;
  gameID?: string;
  // Defaults to a game the server archives -- a public multiplayer match,
  // not a replay of one -- because that is the only kind with achievements
  // to sync.
  gameType?: GameType;
  isReplay?: boolean;
  // How many Win updates a single tick carries. Defaults to one; 0 is a tick
  // with no win at all.
  winUpdateCount?: number;
  winnerPlayer?: {
    isPlayer: () => boolean;
    clientID: () => string | null;
    displayName: () => string;
  };
}): GameView {
  const winUpdate = { winner: opts.winner, allPlayersStats: {} };
  const winUpdates = Array.from(
    { length: opts.winUpdateCount ?? 1 },
    () => winUpdate,
  );
  return {
    myPlayer: () => ({
      isAlive: () => true,
      hasSpawned: () => true,
      team: () => opts.myTeam ?? null,
      clientID: () => opts.myClientID ?? null,
    }),
    inSpawnPhase: () => false,
    updatesSinceLastTick: () => ({ [GameUpdateType.Win]: winUpdates }),
    playerByClientID: () => opts.winnerPlayer,
    config: () => ({
      gameConfig: () => ({
        rankedType: undefined,
        gameType: opts.gameType ?? GameType.Public,
      }),
      isReplay: () => opts.isReplay ?? false,
    }),
    gameID: () => opts.gameID ?? "game-abc-123",
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
    vi.unstubAllGlobals();
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

  it("shows the buttons as soon as show() runs, before the cosmetics fetch settles", async () => {
    // A visible modal activates steam-wishlist, which observes its own size;
    // jsdom has no ResizeObserver.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.mocked(fetchCosmetics).mockReturnValueOnce(new Promise(() => {}));
    setup(makeGame({ winner: ["team", "Blue"], myTeam: "Blue" }));
    document.body.appendChild(modal!);

    void modal!.show();
    await modal!.updateComplete;

    expect(modal!.isVisible).toBe(true);
    const exit = modal!.querySelector(
      "o-button[translationKey='win_modal.exit']",
    );
    expect(exit).not.toBeNull();
    expect(exit!.parentElement!.classList.contains("hidden")).toBe(false);
  });

  it("ignores a player win whose winner is not a known player", () => {
    const events = setup(
      makeGame({ winner: ["player", "gone"], winnerPlayer: undefined }),
    );
    modal!.tick();

    expect(events).toHaveLength(0);
    expect(modal!.isVisible).toBe(false);
  });

  it("syncs achievements with the game's id from gameID(), not the config", () => {
    // Pins the id source: config().gameConfig() is present on this fake game
    // but deliberately carries no gameID field, so a regression that reads
    // the id from there instead of gameID() would pass `undefined` here and
    // fail this assertion.
    setup(
      makeGame({
        winner: ["team", "Blue"],
        myTeam: "Blue",
        gameID: "game-xyz-789",
      }),
    );
    modal!.tick();

    expect(syncAchievements).toHaveBeenCalledWith({ gameId: "game-xyz-789" });
  });

  it("syncs achievements even when the match is cancelled", () => {
    setup(makeGame({ winner: undefined, gameID: "game-cancelled-1" }));
    modal!.tick();

    expect(syncAchievements).toHaveBeenCalledWith({
      gameId: "game-cancelled-1",
    });
  });

  // Only games the server archives are ingested, so no achievement row for a
  // singleplayer game or a replay can ever exist. Polling for one spends the
  // poll's whole schedule -- a /users/@me per attempt -- on a certain miss.
  it("does not sync achievements for a singleplayer game", () => {
    setup(
      makeGame({
        winner: ["team", "Blue"],
        myTeam: "Blue",
        gameType: GameType.Singleplayer,
      }),
    );
    modal!.tick();

    expect(syncAchievements).not.toHaveBeenCalled();
  });

  it("syncs once per game end, not once per Win update in the tick", () => {
    // The sync is about the game being over, which happens once however many
    // Win updates the tick happens to carry.
    setup(
      makeGame({
        winner: ["team", "Blue"],
        myTeam: "Blue",
        winUpdateCount: 3,
      }),
    );
    modal!.tick();

    expect(syncAchievements).toHaveBeenCalledTimes(1);
  });

  it("does not sync achievements on a tick with no Win update", () => {
    setup(
      makeGame({
        winner: ["team", "Blue"],
        myTeam: "Blue",
        winUpdateCount: 0,
      }),
    );
    modal!.tick();

    expect(syncAchievements).not.toHaveBeenCalled();
  });

  it("does not sync achievements while watching a replay", () => {
    setup(
      makeGame({
        winner: ["team", "Blue"],
        myTeam: "Blue",
        gameType: GameType.Public,
        isReplay: true,
      }),
    );
    modal!.tick();

    expect(syncAchievements).not.toHaveBeenCalled();
  });
});
