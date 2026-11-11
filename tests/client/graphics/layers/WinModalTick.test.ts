import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCosmetics } from "../../../../src/client/Cosmetics";
import "../../../../src/client/hud/layers/WinModal";
import type { WinModal } from "../../../../src/client/hud/layers/WinModal";
import { SendWinnerEvent } from "../../../../src/client/Transport";
import type { GameView } from "../../../../src/client/view";

vi.mock("../../../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
  getTranslatedPlayerTeamLabel: vi.fn(
    (team: string | null) => (team === "Red" ? "Rood" : (team ?? "")), // "Rood" is Dutch for "Red"
  ),
  getGamesPlayed: vi.fn(() => 10),
  isInIframe: vi.fn(() => false),
  homeHref: vi.fn(() => "/"),
  renderDuration: (s: number) => `${s}s`,
  formatPercentage: (v: number) => `${v * 100}%`,
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

vi.mock("../../../../src/client/GamePortal", () => ({
  gamePortal: {
    happytime: vi.fn(),
    gameplayStop: vi.fn(),
    // Read by the win modal's <steam-wishlist> and <profile-share>.
    name: () => null,
  },
}));

import { gamePortal } from "../../../../src/client/GamePortal";
import {
  getTranslatedPlayerTeamLabel,
  translateText,
} from "../../../../src/client/Utils";

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
      numTilesOwned: () => 100,
      team: () => opts.myTeam ?? null,
      clientID: () => opts.myClientID ?? null,
    }),
    inSpawnPhase: () => false,
    ticks: () => 6000,
    elapsedGameSeconds: () => 600,
    numLandTiles: () => 1000,
    numTilesWithFallout: () => 0,
    playerViews: () => [],
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
    vi.unstubAllGlobals();
  });

  it("emits the winner and celebrates when my team wins", async () => {
    const events = setup(
      makeGame({ winner: ["team", "Blue"], myTeam: "Blue" }),
    );
    modal!.tick();

    expect(events).toHaveLength(1);
    expect(events[0].winner).toEqual(["team", "Blue"]);
    expect(gamePortal.happytime).toHaveBeenCalled();
    await vi.waitFor(() => expect(modal!.isVisible).toBe(true));
  });

  it("emits the (translated) winner without celebrating when another team wins", async () => {
    const events = setup(makeGame({ winner: ["team", "Red"], myTeam: "Blue" }));
    modal!.tick();

    expect(events).toHaveLength(1);
    expect(events[0].winner).toEqual(["team", "Red"]);
    expect(gamePortal.happytime).not.toHaveBeenCalled();
    expect(getTranslatedPlayerTeamLabel).toHaveBeenCalledWith("Red");
    expect(translateText).toHaveBeenCalledWith("win_modal.other_team", {
      team: "Rood",
    });
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
    expect(gamePortal.happytime).not.toHaveBeenCalled();
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

    expect(gamePortal.happytime).toHaveBeenCalled();
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
    const exit = modal!.querySelector("[data-win-action='exit']");
    expect(exit).not.toBeNull();
    expect(exit!.parentElement!.classList.contains("hidden")).toBe(false);
  });

  it("puts leaving on the left and staying on the right, and staying closes the modal", async () => {
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

    const actions = [
      ...modal!.querySelectorAll<HTMLButtonElement>("[data-win-action]"),
    ];
    expect(actions.map((b) => b.getAttribute("data-win-action"))).toEqual([
      "exit",
      "keep",
      "share",
    ]);
    // Leaving is the quiet button, staying the main one.
    expect(actions.map((b) => b.dataset.winTone)).toEqual([
      "quiet",
      "main",
      "quiet",
    ]);

    actions[1].click();
    await modal!.updateComplete;
    expect(modal!.isVisible).toBe(false);
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

describe("WinModal title and stats", () => {
  let modal: WinModal | undefined;

  // How "win_modal.you_won" reads in the language a test plays in.
  let youWon: string;
  const english: Record<string, string> = {
    "win_modal.other_won": "{player} has won!",
    "win_modal.stat_rank_value": "#{rank}/{players}",
  };

  beforeEach(() => {
    youWon = "You Won!";
    vi.mocked(translateText).mockImplementation(
      (key: string, params?: Record<string, string | number>) =>
        (key === "win_modal.you_won" ? youWon : (english[key] ?? key)).replace(
          /\{(\w+)\}/g,
          (_, name: string) => String(params?.[name]),
        ),
    );
  });

  afterEach(() => {
    modal?.remove();
    modal = undefined;
    vi.mocked(translateText).mockReset();
    vi.restoreAllMocks();
  });

  function player(tiles: number) {
    return {
      isAlive: () => tiles > 0,
      hasSpawned: () => true,
      numTilesOwned: () => tiles,
      team: () => null,
      clientID: () => null,
    };
  }

  async function open(game: GameView, rand = 0.9): Promise<void> {
    modal = document.createElement("win-modal") as WinModal;
    modal.game = game;
    modal.eventBus = new EventBus();
    // 0.9 is the patterns promo: no Steam widget, which jsdom can't run.
    (modal as unknown as { rand: number }).rand = rand;
    document.body.appendChild(modal);
    modal.tick();
    await modal.updateComplete;
  }

  const stat = (name: string) =>
    modal!.querySelector(`[data-win-stat="${name}"]`)?.textContent;

  const meWinning = (title: string) => {
    youWon = title;
    return makeGame({
      winner: ["player", "me"],
      myClientID: "me",
      winnerPlayer: {
        isPlayer: () => true,
        clientID: () => "me",
        displayName: () => "Me",
      },
    });
  };

  it("shows the time, land share and rank from the game on a win", async () => {
    const me = { ...player(200), clientID: () => "me" };
    await open({
      ...makeGame({
        winner: ["player", "me"],
        winnerPlayer: {
          isPlayer: () => true,
          clientID: () => "me",
          displayName: () => "Me",
        },
      }),
      myPlayer: () => me,
      playerViews: () => [player(300), me, player(100), player(0)],
      elapsedGameSeconds: () => 754.6,
    } as unknown as GameView);

    expect(stat("time")).toContain("754s");
    expect(stat("land")).toContain("20%");
    expect(stat("rank")).toContain("#2/4");
  });

  it("in a team game shows the team's land and my rank among my teammates", async () => {
    const teamPlayer = (tiles: number, team: string) => ({
      ...player(tiles),
      team: () => team,
    });
    const me = teamPlayer(100, "Blue");
    await open({
      ...makeGame({ winner: ["team", "Blue"], myTeam: "Blue" }),
      myPlayer: () => me,
      playerViews: () => [teamPlayer(400, "Red"), teamPlayer(300, "Blue"), me],
    } as unknown as GameView);

    expect(stat("land")).toContain("win_modal.stat_team_land");
    expect(stat("land")).toContain("40%");
    expect(stat("rank")).toContain("win_modal.stat_team_rank");
    expect(stat("rank")).toContain("#2/2");
  });

  it("keeps the stats from a death when the game ends later", async () => {
    let seconds = 300;
    let ended = false;
    const other = { tiles: 300 };
    const rival = {
      ...player(0),
      isAlive: () => other.tiles > 0,
      numTilesOwned: () => other.tiles,
    };
    const me = player(0);
    const game = {
      ...makeGame({ winner: ["team", "Red"], myTeam: "Blue" }),
      myPlayer: () => me,
      playerViews: () => [rival, me, player(50)],
      elapsedGameSeconds: () => seconds,
      updatesSinceLastTick: () =>
        ended
          ? {
              [GameUpdateType.Win]: [
                { winner: ["team", "Red"], allPlayersStats: {} },
              ],
            }
          : {},
    } as unknown as GameView;

    await open(game);
    expect(stat("time")).toContain("300s");
    expect(stat("rank")).toContain("#3/3");
    expect(stat("land")).toBeUndefined();

    seconds = 900;
    other.tiles = 0;
    ended = true;
    modal!.tick();
    await modal!.updateComplete;

    expect(stat("time")).toContain("300s");
    expect(stat("rank")).toContain("#3/3");
  });

  it("shows a spectator the time only", async () => {
    await open({
      ...makeGame({ winner: ["team", "Red"] }),
      myPlayer: () => null,
      playerViews: () => [player(300), player(100)],
    } as unknown as GameView);

    expect(stat("time")).toContain("600s");
    expect(stat("land")).toBeUndefined();
    expect(stat("rank")).toBeUndefined();
  });

  it("shows no stats for a match cancelled in the spawn phase", async () => {
    await open({
      ...makeGame({ winner: undefined }),
      inSpawnPhase: () => true,
    } as unknown as GameView);

    expect(modal!.isVisible).toBe(true);
    expect(modal!.querySelector("[data-win-stats]")).toBeNull();
  });

  it("draws a headline the pixel font has every letter of in that font", async () => {
    await open(meWinning("You Won!"));
    const title = modal!.querySelector("#win-modal-title")!;
    expect(title.getAttribute("data-title-font")).toBe("display");
    expect(title.textContent!.trim()).toBe("You Won!");
  });

  it("lifts each ! and ? of a pixel-font headline on its own, without changing the text", async () => {
    await open(meWinning("Ready? Go!!"));
    const title = modal!.querySelector("#win-modal-title")!;
    expect(title.textContent!.trim()).toBe("Ready? Go!!");
    const marks = [...title.querySelectorAll("span")].map((s) => s.textContent);
    expect(marks).toEqual(["?", "!", "!"]);
  });

  it("draws an accented headline in the pixel font without its accents, and keeps them for screen readers", async () => {
    await open(meWinning("Vous avez gagné\u202f!"));
    const title = modal!.querySelector("#win-modal-title")!;
    expect(title.getAttribute("data-title-font")).toBe("display");
    expect(title.querySelector("[aria-hidden='true']")?.textContent).toBe(
      "Vous avez gagne !",
    );
    expect(title.querySelector(".sr-only")?.textContent).toBe(
      "Vous avez gagné\u202f!",
    );
  });

  it("keeps a headline in another script in the UI font", async () => {
    await open(meWinning("Вы победили!"));
    const title = modal!.querySelector("#win-modal-title")!;
    expect(title.getAttribute("data-title-font")).toBe("ui");
    expect(title.textContent!.trim()).toBe("Вы победили!");
  });

  it("never draws a title with a player's name in the pixel font", async () => {
    await open(
      makeGame({
        winner: ["player", "bob"],
        myClientID: "me",
        winnerPlayer: {
          isPlayer: () => true,
          clientID: () => "bob",
          displayName: () => "Bob",
        },
      }),
    );
    const title = modal!.querySelector("#win-modal-title")!;
    expect(title.textContent!.trim()).toBe("Bob has won!");
    expect(title.getAttribute("data-title-font")).toBe("ui");
  });

  it("shows no promo on Poki", async () => {
    vi.spyOn(gamePortal, "name").mockReturnValue("poki");
    // 0.1 would be the Steam promo anywhere else.
    await open(makeGame({ winner: ["team", "Red"] }), 0.1);

    expect(modal!.querySelector("[data-win-promo]")).toBeNull();
    expect(modal!.textContent).not.toContain("steam_wishlist.buy_on_steam");
  });
});
