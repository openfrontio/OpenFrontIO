// @vitest-environment jsdom
import { GameMode } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { GameLeftSidebar } from "../src/client/hud/layers/GameLeftSidebar";
import type { PlayerStats } from "../src/client/hud/layers/PlayerStats";
import type { TeamStats } from "../src/client/hud/layers/TeamStats";
import { AlternateViewEvent } from "../src/client/InputHandler";
import { UserSettings } from "../src/client/UserSettings";
import {
  getTranslatedPlayerTeamLabel,
  translateText,
} from "../src/client/Utils";
import type { GameView, PlayerView } from "../src/client/view";

function ffaGame(): GameView {
  const player = {
    id: () => "player-1",
    smallID: () => 0,
    name: () => "Player 1",
    displayName: () => "Player 1",
    clanTag: () => null,
    numTilesOwned: () => 10,
    gold: () => 100n,
    tradeGold: () => 0,
    trainGold: () => 0,
    piracyGold: () => 0,
    goldEarned: () => 0,
    isAlive: () => true,
    isOnSameTeam: () => false,
    team: () => null,
  } as unknown as PlayerView;
  return {
    config: () => ({
      gameConfig: () => ({ gameMode: GameMode.FFA }),
      maxTroops: () => 1_000,
    }),
    gameID: () => "test-game",
    inSpawnPhase: () => false,
    myPlayer: () => player,
    numLandTiles: () => 100,
    ticks: () => 600,
    numTilesWithFallout: () => 0,
    playerViews: () => [player],
  } as unknown as GameView;
}

function teamGame(inSpawnPhase: () => boolean): GameView {
  const game = ffaGame();
  const player = {
    ...game.myPlayer(),
    team: () => "Red",
    isOnSameTeam: () => true,
  } as unknown as PlayerView;
  return {
    ...game,
    config: () => ({
      gameConfig: () => ({ gameMode: GameMode.Team }),
      maxTroops: () => 1_000,
    }),
    inSpawnPhase,
    myPlayer: () => player,
    playerViews: () => [player],
    teamClanTag: () => null,
  } as unknown as GameView;
}

// What a browser does with a key on a focused button: Enter presses it on
// keydown, Space on keyup, unless the page cancelled that event.
function pressKey(button: HTMLElement, key: "Enter" | " "): void {
  const code = key === " " ? "Space" : "Enter";
  for (const type of ["keydown", "keyup"] as const) {
    const event = new KeyboardEvent(type, {
      key,
      code,
      bubbles: true,
      cancelable: true,
    });
    button.dispatchEvent(event);
    const presses = key === "Enter" ? type === "keydown" : type === "keyup";
    if (presses && !event.defaultPrevented) button.click();
  }
}

function keysOnWindow(): { seen: string[]; stop: () => void } {
  const seen: string[] = [];
  const listener = (e: KeyboardEvent) => seen.push(`${e.type} ${e.code}`);
  window.addEventListener("keydown", listener);
  window.addEventListener("keyup", listener);
  return {
    seen,
    stop: () => {
      window.removeEventListener("keydown", listener);
      window.removeEventListener("keyup", listener);
    },
  };
}

describe("GameLeftSidebar", () => {
  beforeEach(() => {
    localStorage.clear();
    (
      UserSettings as unknown as { cache: Map<string, string | null> }
    ).cache.clear();
  });

  it("owns the player and team stats tables", async () => {
    const game = {
      config: () => ({ gameConfig: () => ({ gameMode: GameMode.Team }) }),
    } as unknown as GameView;
    const eventBus = new EventBus();
    const sidebar = new GameLeftSidebar();
    sidebar.game = game;
    sidebar.eventBus = eventBus;
    document.body.append(sidebar);

    await sidebar.updateComplete;

    const playerStats = sidebar.querySelector("player-stats");
    const teamStats = sidebar.querySelector("team-stats");
    expect(typeof (playerStats as PlayerStats).refresh).toBe("function");
    expect(typeof (teamStats as TeamStats).refresh).toBe("function");
    expect((playerStats as PlayerStats).game).toBe(game);
    expect((playerStats as PlayerStats).eventBus).toBe(eventBus);
    expect((teamStats as TeamStats).game).toBe(game);

    sidebar.remove();
  });

  it("renders the player stats table after toggling it", async () => {
    const game = ffaGame();
    const sidebar = new GameLeftSidebar();
    sidebar.game = game;
    sidebar.eventBus = new EventBus();
    document.body.append(sidebar);
    sidebar.init();
    await sidebar.updateComplete;

    (
      sidebar.querySelector('[data-sidebar-button="players"]') as HTMLElement
    ).click();
    await sidebar.updateComplete;

    const playerStats = sidebar.querySelector("player-stats") as PlayerStats;
    await playerStats.updateComplete;
    expect(playerStats.visible).toBe(true);
    expect(playerStats.querySelector(".stats-table")).not.toBeNull();

    expect(() => sidebar.tick()).not.toThrow();
    await playerStats.updateComplete;
    expect(playerStats.querySelector(".stats-table-row")).not.toBeNull();

    sidebar.remove();
  });

  it.each([
    { viewport: "a large screen", compact: false, shown: true },
    {
      viewport: "a compact screen (Poki's frame)",
      compact: true,
      shown: false,
    },
  ])(
    "opens the leaderboard after spawn by default on $viewport",
    async ({ compact, shown }) => {
      vi.stubGlobal("innerWidth", 1280);
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches: compact,
        media: query,
      }));
      const sidebar = new GameLeftSidebar();
      sidebar.game = ffaGame();
      sidebar.eventBus = new EventBus();
      document.body.append(sidebar);
      sidebar.init();
      sidebar.tick();
      await sidebar.updateComplete;

      const playerStats = sidebar.querySelector("player-stats") as PlayerStats;
      expect(playerStats.visible).toBe(shown);

      sidebar.remove();
      vi.unstubAllGlobals();
    },
  );

  it("stacks the player and team stats tables vertically at every width", async () => {
    const game = {
      config: () => ({ gameConfig: () => ({ gameMode: GameMode.Team }) }),
    } as unknown as GameView;
    const sidebar = new GameLeftSidebar();
    sidebar.game = game;
    sidebar.eventBus = new EventBus();
    document.body.append(sidebar);
    await sidebar.updateComplete;

    const wrapper = sidebar.querySelector("player-stats")?.parentElement;
    expect(wrapper?.classList).toContain("flex-col");
    expect(wrapper?.className).not.toMatch(/flex-wrap|lg:flex/);
    expect(sidebar.querySelector("team-stats")?.className).not.toContain(
      "lg:flex-initial",
    );

    sidebar.remove();
  });

  it("toggles the alternate view and follows it when space switches it", async () => {
    const eventBus = new EventBus();
    const seen: boolean[] = [];
    eventBus.on(AlternateViewEvent, (e) => seen.push(e.alternateView));
    const sidebar = new GameLeftSidebar();
    sidebar.game = ffaGame();
    sidebar.eventBus = eventBus;
    document.body.append(sidebar);
    sidebar.init();
    await sidebar.updateComplete;

    const button = () =>
      sidebar.querySelector<HTMLElement>(
        '[data-sidebar-button="view"]',
      ) as HTMLElement;
    button().click();
    await sidebar.updateComplete;
    expect(seen).toEqual([true]);
    expect(button().getAttribute("aria-pressed")).toBe("true");

    // Releasing space turns it off from outside the button.
    eventBus.emit(new AlternateViewEvent(false));
    await sidebar.updateComplete;
    expect(button().getAttribute("aria-pressed")).toBe("false");
    button().click();
    expect(seen).toEqual([true, false, true]);

    sidebar.remove();
  });

  it("draws its toggles as buttons with a name and a pressed state", async () => {
    const sidebar = new GameLeftSidebar();
    sidebar.game = ffaGame();
    sidebar.eventBus = new EventBus();
    document.body.append(sidebar);
    sidebar.init();
    await sidebar.updateComplete;

    const toggle = (name: string) =>
      sidebar.querySelector<HTMLButtonElement>(
        `[data-sidebar-button="${name}"]`,
      );
    expect(toggle("teams")).toBeNull();
    for (const [name, key] of [
      ["players", "help_modal.icon_alt_player_leaderboard"],
      ["view", "user_setting.toggle_view_desc"],
    ]) {
      const button = toggle(name);
      expect(button?.tagName).toBe("BUTTON");
      expect(button?.type).toBe("button");
      expect(button?.getAttribute("aria-label")).toBe(translateText(key));
      expect(button?.title).toBe(translateText(key));
      expect(button?.getAttribute("aria-pressed")).toBe("false");
    }

    toggle("players")?.click();
    await sidebar.updateComplete;
    expect(toggle("players")?.getAttribute("aria-pressed")).toBe("true");

    sidebar.remove();

    const teamSidebar = new GameLeftSidebar();
    teamSidebar.game = teamGame(() => true);
    teamSidebar.eventBus = new EventBus();
    document.body.append(teamSidebar);
    teamSidebar.init();
    await teamSidebar.updateComplete;

    const teams = teamSidebar.querySelector<HTMLButtonElement>(
      '[data-sidebar-button="teams"]',
    );
    expect(teams?.getAttribute("aria-label")).toBe(
      translateText("help_modal.icon_alt_team_leaderboard"),
    );
    expect(teams?.title).toBe(
      translateText("help_modal.icon_alt_team_leaderboard"),
    );
    expect(teams?.getAttribute("aria-pressed")).toBe("false");

    teamSidebar.remove();
  });

  it("switches the alternate view on Enter, and leaves Space to the game", async () => {
    const eventBus = new EventBus();
    const views: boolean[] = [];
    eventBus.on(AlternateViewEvent, (e) => views.push(e.alternateView));
    const sidebar = new GameLeftSidebar();
    sidebar.game = ffaGame();
    sidebar.eventBus = eventBus;
    document.body.append(sidebar);
    sidebar.init();
    await sidebar.updateComplete;
    const button = sidebar.querySelector<HTMLElement>(
      '[data-sidebar-button="view"]',
    ) as HTMLElement;
    const keys = keysOnWindow();

    pressKey(button, "Enter");
    expect(views).toEqual([true]);
    expect(keys.seen).toEqual(["keyup Enter"]);

    keys.seen.length = 0;
    pressKey(button, " ");
    expect(views).toEqual([true]);
    expect(keys.seen).toEqual(["keydown Space", "keyup Space"]);

    keys.stop();
    sidebar.remove();
  });

  it("keeps Space and Enter on the leaderboard button from the game", async () => {
    const sidebar = new GameLeftSidebar();
    sidebar.game = ffaGame();
    sidebar.eventBus = new EventBus();
    document.body.append(sidebar);
    sidebar.init();
    await sidebar.updateComplete;
    const button = sidebar.querySelector<HTMLElement>(
      '[data-sidebar-button="players"]',
    ) as HTMLElement;
    const keys = keysOnWindow();

    pressKey(button, "Enter");
    await sidebar.updateComplete;
    expect(button.getAttribute("aria-pressed")).toBe("true");
    pressKey(button, " ");
    await sidebar.updateComplete;
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(keys.seen).toEqual([]);

    keys.stop();
    sidebar.remove();
  });

  it("shows the game ID while a table is open and copies it on a click", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const sidebar = new GameLeftSidebar();
    sidebar.game = ffaGame();
    sidebar.eventBus = new EventBus();
    document.body.append(sidebar);
    sidebar.init();
    await sidebar.updateComplete;

    const gameId = () =>
      sidebar.querySelector<HTMLButtonElement>("[data-game-id]");
    expect(gameId()).toBeNull();
    sidebar
      .querySelector<HTMLElement>('[data-sidebar-button="players"]')
      ?.click();
    await sidebar.updateComplete;
    const button = gameId() as HTMLButtonElement;
    expect(button.getAttribute("aria-label")).toBe(
      `${translateText("help_modal.game_id_tooltip")} test-game`,
    );

    button.click();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith("test-game");
    expect(button.hasAttribute("data-copied")).toBe(true);

    // "Copied!" is shown by an animation; its end puts the ID back.
    button.lastElementChild?.dispatchEvent(
      new Event("animationend", { bubbles: true }),
    );
    expect(button.hasAttribute("data-copied")).toBe(false);

    sidebar.remove();
    delete (navigator as { clipboard?: unknown }).clipboard;
  });

  it("leaves the game ID as it is when there is no clipboard", async () => {
    expect(navigator.clipboard).toBeUndefined();
    const sidebar = new GameLeftSidebar();
    sidebar.game = ffaGame();
    sidebar.eventBus = new EventBus();
    document.body.append(sidebar);
    sidebar.init();
    await sidebar.updateComplete;
    sidebar
      .querySelector<HTMLElement>('[data-sidebar-button="players"]')
      ?.click();
    await sidebar.updateComplete;

    const button = sidebar.querySelector("[data-game-id]") as HTMLElement;
    expect(() => button.click()).not.toThrow();
    await Promise.resolve();
    expect(button.hasAttribute("data-copied")).toBe(false);

    sidebar.remove();
  });

  it("shows your team during the spawn phase of a team game", async () => {
    let spawning = true;
    const sidebar = new GameLeftSidebar();
    sidebar.game = teamGame(() => spawning);
    sidebar.eventBus = new EventBus();
    document.body.append(sidebar);
    sidebar.init();
    sidebar.tick();
    await sidebar.updateComplete;

    const line = () => sidebar.querySelector("[data-your-team]");
    expect(line()?.textContent).toContain(
      translateText("help_modal.ui_your_team"),
    );
    expect(line()?.textContent).toContain(getTranslatedPlayerTeamLabel("Red"));

    spawning = false;
    sidebar.tick();
    await sidebar.updateComplete;
    expect(line()).toBeNull();

    sidebar.remove();
  });
});
