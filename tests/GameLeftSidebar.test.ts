// @vitest-environment jsdom
import { GameMode } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { colord } from "colord";
import type { ColumnPicker } from "../src/client/hud/layers/ColumnPicker";
import { GameLeftSidebar } from "../src/client/hud/layers/GameLeftSidebar";
import type { PlayerStats } from "../src/client/hud/layers/PlayerStats";
import type { TeamStats } from "../src/client/hud/layers/TeamStats";
import { AlternateViewEvent, InputHandler } from "../src/client/InputHandler";
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
    troops: () => 500,
    totalUnitLevels: () => 0,
    isAlive: () => true,
    isOnSameTeam: () => false,
    team: () => null,
    territoryColor: () => colord("#4a90d9"),
    incomingAttacks: () => [],
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

  it("reserves warning space only for expanded sidebars on narrow screens", async () => {
    const sidebar = new GameLeftSidebar();
    sidebar.game = ffaGame();
    document.body.append(sidebar);
    await sidebar.updateComplete;

    const aside = () => sidebar.querySelector("aside")!;
    const offsetMargin =
      "max-lg:mt-[calc(var(--bar-offset)+var(--game-health-offset,0px))]";
    const offsetHeight =
      "max-lg:max-h-[calc(100vh-80px-var(--game-health-offset,0px))]";
    expect(aside().classList).not.toContain(offsetMargin);
    expect(aside().classList).not.toContain(offsetHeight);
    expect(aside().style.marginTop).toBe("");
    expect(aside().style.getPropertyValue("--bar-offset")).toBe("0px");

    (
      sidebar.querySelector('[data-sidebar-button="players"]') as HTMLElement
    ).click();
    await sidebar.updateComplete;
    expect(aside().classList).toContain(offsetMargin);
    expect(aside().classList).toContain(offsetHeight);

    (
      sidebar.querySelector('[data-sidebar-button="players"]') as HTMLElement
    ).click();
    await sidebar.updateComplete;
    expect(aside().classList).not.toContain(offsetMargin);
    expect(aside().classList).not.toContain(offsetHeight);
    sidebar.remove();
  });

  it("does not retain focus on mouse click so Space does not re-toggle the leaderboard", async () => {
    const sidebar = new GameLeftSidebar();
    sidebar.game = ffaGame();
    sidebar.eventBus = new EventBus();
    document.body.append(sidebar);
    sidebar.init();
    await sidebar.updateComplete;

    const btn = sidebar.querySelector(
      "button[data-sidebar-button]",
    ) as HTMLElement;
    const mousedown = new MouseEvent("mousedown", { cancelable: true });
    btn.dispatchEvent(mousedown);
    expect(mousedown.defaultPrevented).toBe(true);

    btn.focus();
    btn.dispatchEvent(new MouseEvent("click", { detail: 1 }));
    expect(document.activeElement).not.toBe(btn);
    sidebar.remove();
  });

  it("clears focus from a previously focused leaderboard control on mousedown", async () => {
    const sidebar = new GameLeftSidebar();
    sidebar.game = {
      ...ffaGame(),
      teamClanTag: () => null,
      config: () => ({
        gameConfig: () => ({ gameMode: GameMode.Team }),
        maxTroops: () => 1_000,
      }),
    } as unknown as GameView;
    sidebar.eventBus = new EventBus();
    document.body.append(sidebar);
    sidebar.init();
    await sidebar.updateComplete;

    const buttons = sidebar.querySelectorAll<HTMLElement>(
      "button[data-sidebar-button]",
    );
    const [playerBtn, teamBtn] = [buttons[0], buttons[1]];
    playerBtn.focus();
    expect(document.activeElement).toBe(playerBtn);

    teamBtn.dispatchEvent(new MouseEvent("mousedown", { cancelable: true }));
    expect(document.activeElement).not.toBe(playerBtn);
    expect(document.activeElement).not.toBe(teamBtn);
    sidebar.remove();
  });

  it("leaves no focus on a leaderboard control after a mouse click on the alternate view button", async () => {
    const eventBus = new EventBus();
    const views: boolean[] = [];
    eventBus.on(AlternateViewEvent, (e) => views.push(e.alternateView));
    const sidebar = new GameLeftSidebar();
    sidebar.game = ffaGame();
    sidebar.eventBus = eventBus;
    document.body.append(sidebar);
    sidebar.init();
    await sidebar.updateComplete;

    const playerBtn = sidebar.querySelector<HTMLElement>(
      '[data-sidebar-button="players"]',
    ) as HTMLElement;
    const viewBtn = sidebar.querySelector<HTMLElement>(
      '[data-sidebar-button="view"]',
    ) as HTMLElement;
    playerBtn.focus();
    const mousedown = new MouseEvent("mousedown", { cancelable: true });
    viewBtn.dispatchEvent(mousedown);
    expect(mousedown.defaultPrevented).toBe(true);
    expect(document.activeElement).not.toBe(playerBtn);

    viewBtn.focus();
    viewBtn.dispatchEvent(new MouseEvent("click", { detail: 1 }));
    expect(document.activeElement).not.toBe(viewBtn);
    expect(views).toEqual([true]);

    // A keyboard press (detail 0) leaves focus where it is.
    viewBtn.focus();
    viewBtn.dispatchEvent(new MouseEvent("click", { detail: 0 }));
    expect(document.activeElement).toBe(viewBtn);
    expect(views).toEqual([true, false]);
    sidebar.remove();
  });

  it("stops Enter/Space keydown from bubbling to window on leaderboard toggles", async () => {
    const sidebar = new GameLeftSidebar();
    sidebar.game = {
      ...ffaGame(),
      teamClanTag: () => null,
      config: () => ({
        gameConfig: () => ({ gameMode: GameMode.Team }),
        maxTroops: () => 1_000,
      }),
    } as unknown as GameView;
    sidebar.eventBus = new EventBus();
    document.body.append(sidebar);
    sidebar.init();
    await sidebar.updateComplete;

    const windowKeydown = vi.fn();
    window.addEventListener("keydown", windowKeydown);

    const buttons = sidebar.querySelectorAll<HTMLElement>(
      "button[data-sidebar-button]",
    );
    buttons[0].dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true }),
    );
    buttons[1].dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    expect(windowKeydown).not.toHaveBeenCalled();
    window.removeEventListener("keydown", windowKeydown);
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
      // A mouse press leaves no focus on it, so Space stays the game's.
      const press = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
      });
      button?.dispatchEvent(press);
      expect(press.defaultPrevented).toBe(true);
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

  it("presses the alternate view button with Enter and Space, and keeps both from the game", async () => {
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
    pressKey(button, " ");
    expect(views).toEqual([true, false]);
    expect(keys.seen).toEqual([]);

    keys.stop();
    sidebar.remove();
  });

  it("follows Space held anywhere but on the button", async () => {
    const eventBus = new EventBus();
    const sidebar = new GameLeftSidebar();
    sidebar.game = ffaGame();
    sidebar.eventBus = eventBus;
    document.body.append(sidebar);
    sidebar.init();
    const input = new InputHandler(
      sidebar.game,
      {
        attackRatio: 20,
        ghostStructure: null,
        rocketDirectionUp: true,
        upgradeMultiplier: 1,
      },
      document.createElement("canvas"),
      eventBus,
    );
    input.initialize();
    await sidebar.updateComplete;
    const button = () =>
      sidebar.querySelector<HTMLElement>(
        '[data-sidebar-button="view"]',
      ) as HTMLElement;

    const space = (type: "keydown" | "keyup") =>
      document.body.dispatchEvent(
        new KeyboardEvent(type, { key: " ", code: "Space", bubbles: true }),
      );
    space("keydown");
    await sidebar.updateComplete;
    expect(button().getAttribute("aria-pressed")).toBe("true");
    space("keyup");
    await sidebar.updateComplete;
    expect(button().getAttribute("aria-pressed")).toBe("false");

    input.destroy();
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

    // A Space that went down on the map and comes up here is the game's
    // hold: the release ends the alternate view, so it goes through.
    button.dispatchEvent(
      new KeyboardEvent("keyup", { key: " ", code: "Space", bubbles: true }),
    );
    expect(keys.seen).toEqual(["keyup Space"]);

    // So is a Space that comes up here after focus left with the last one
    // still down: that release never came, and this one is not its.
    button.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true }),
    );
    button.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    button.dispatchEvent(
      new KeyboardEvent("keyup", { key: " ", code: "Space", bubbles: true }),
    );
    expect(keys.seen).toEqual(["keyup Space", "keyup Space"]);

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
    // A screen reader hears it too: the button itself does not change.
    const status = sidebar.querySelector("[data-game-id-status]");
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.textContent).toBe(translateText("common.copied"));

    // "Copied!" is shown by an animation; its end puts the ID back.
    button.lastElementChild?.dispatchEvent(
      new Event("animationend", { bubbles: true }),
    );
    expect(button.hasAttribute("data-copied")).toBe(false);
    expect(status?.textContent).toBe("");

    sidebar.remove();
    delete (navigator as { clipboard?: unknown }).clipboard;
  });

  it("selects the game ID when the clipboard refuses it", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
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
    button.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(button.hasAttribute("data-copied")).toBe(false);
    expect(getSelection()?.toString()).toBe("test-game");

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

  it("offers the column menu while a table is open, one section per table", async () => {
    const sidebar = new GameLeftSidebar();
    sidebar.game = teamGame(() => false);
    sidebar.eventBus = new EventBus();
    document.body.append(sidebar);
    sidebar.init();
    await sidebar.updateComplete;

    const button = (name: string) =>
      sidebar.querySelector<HTMLButtonElement>(
        `[data-sidebar-button="${name}"]`,
      );
    const sections = () =>
      [...document.body.querySelectorAll("[data-column-section]")].map(
        (section) => section.getAttribute("data-column-section"),
      );
    expect(button("columns")).toBeNull();

    button("players")?.click();
    await sidebar.updateComplete;
    const columns = button("columns");
    expect(columns?.getAttribute("aria-label")).toBe(
      translateText("leaderboard.configure_columns"),
    );
    expect(columns?.getAttribute("aria-haspopup")).toBe("dialog");
    expect(columns?.getAttribute("aria-expanded")).toBe("false");

    const picker = sidebar.querySelector("column-picker") as ColumnPicker;
    columns?.click();
    await picker.updateComplete;
    expect(columns?.getAttribute("aria-expanded")).toBe("true");
    expect(sections()).toEqual(["player"]);

    // A press on another button of the bar closes it, like any press outside.
    button("teams")?.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
    button("teams")?.click();
    await sidebar.updateComplete;
    await picker.updateComplete;
    expect(columns?.getAttribute("aria-expanded")).toBe("false");
    expect(sections()).toEqual([]);

    columns?.click();
    await picker.updateComplete;
    expect(sections()).toEqual(["player", "team"]);

    columns?.click();
    await picker.updateComplete;
    expect(columns?.getAttribute("aria-expanded")).toBe("false");
    expect(sections()).toEqual([]);

    sidebar.remove();
  });

  it("shows a column ticked in the menu at once, in that table only", async () => {
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
    sidebar.tick();
    sidebar
      .querySelector<HTMLElement>('[data-sidebar-button="columns"]')
      ?.click();
    const picker = sidebar.querySelector("column-picker") as ColumnPicker;
    await picker.updateComplete;

    const playerStats = sidebar.querySelector("player-stats") as PlayerStats;
    const header = () =>
      playerStats.querySelector('[role="columnheader"][data-column="cities"]');
    expect(header()).toBeNull();
    const cities = [
      ...document.body.querySelectorAll<HTMLInputElement>(
        '[data-column-section="player"] input[type="checkbox"]',
      ),
    ].find(
      (box) =>
        box.closest("label")?.textContent?.trim() === "leaderboard.cities",
    );
    cities?.click();
    await playerStats.updateComplete;

    expect(new UserSettings().statsColumns("player")).toContain("cities");
    expect(new UserSettings().statsColumns("team")).not.toContain("cities");
    expect(header()).not.toBeNull();

    sidebar.remove();
  });

  it("closes a column menu opened from a header with one press of its button", async () => {
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
    const picker = sidebar.querySelector("column-picker") as ColumnPicker;
    sidebar.querySelector("player-stats")?.dispatchEvent(
      new CustomEvent("columns-menu", {
        bubbles: true,
        detail: { x: 10, y: 10 },
      }),
    );
    await picker.updateComplete;
    expect(document.body.querySelector("[data-column-menu]")).not.toBeNull();

    const columns = sidebar.querySelector<HTMLElement>(
      '[data-sidebar-button="columns"]',
    );
    columns?.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
    columns?.click();
    await picker.updateComplete;
    expect(document.body.querySelector("[data-column-menu]")).toBeNull();

    sidebar.remove();
  });

  it("lights the column menu's button while a right-click on a header has it open", async () => {
    const sidebar = new GameLeftSidebar();
    sidebar.game = teamGame(() => false);
    sidebar.eventBus = new EventBus();
    document.body.append(sidebar);
    sidebar.init();
    await sidebar.updateComplete;
    for (const name of ["players", "teams"]) {
      sidebar
        .querySelector<HTMLElement>(`[data-sidebar-button="${name}"]`)
        ?.click();
      await sidebar.updateComplete;
    }
    sidebar.tick();
    const playerStats = sidebar.querySelector("player-stats") as PlayerStats;
    const teamStats = sidebar.querySelector("team-stats") as TeamStats;
    await playerStats.updateComplete;
    await teamStats.updateComplete;
    const picker = sidebar.querySelector("column-picker") as ColumnPicker;
    const columns = sidebar.querySelector<HTMLElement>(
      '[data-sidebar-button="columns"]',
    );
    const rightClick = async (table: Element) => {
      table
        .querySelector('[role="columnheader"] button')
        ?.dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
        );
      await picker.updateComplete;
    };

    await rightClick(playerStats);
    expect(document.body.querySelector("[data-column-menu]")).not.toBeNull();
    expect(columns?.getAttribute("aria-expanded")).toBe("true");
    await rightClick(playerStats);
    expect(columns?.getAttribute("aria-expanded")).toBe("false");

    await rightClick(teamStats);
    expect(document.body.querySelector("[data-column-menu]")).not.toBeNull();
    expect(columns?.getAttribute("aria-expanded")).toBe("true");
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await picker.updateComplete;
    expect(document.body.querySelector("[data-column-menu]")).toBeNull();
    expect(columns?.getAttribute("aria-expanded")).toBe("false");

    sidebar.remove();
  });

  it("opens the column menu on its first box only from the header the keyboard is on", async () => {
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
    sidebar.tick();
    const playerStats = sidebar.querySelector("player-stats") as PlayerStats;
    await playerStats.updateComplete;
    const picker = sidebar.querySelector("column-picker") as ColumnPicker;
    const sort = (column: string) =>
      playerStats.querySelector<HTMLElement>(
        `[role="columnheader"][data-column="${column}"] button`,
      )!;
    const contextMenu = async (target: Element, button: number) => {
      target.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button,
        }),
      );
      await picker.updateComplete;
    };
    const menu = () => document.body.querySelector("[data-column-menu]");
    const firstBox = () =>
      menu()?.querySelector<HTMLInputElement>('input[type="checkbox"]');

    // The keyboard is on the gold header.
    const gold = sort("gold");
    gold.focus();
    const matches = gold.matches.bind(gold);
    vi.spyOn(gold, "matches").mockImplementation(
      (selector) => selector === ":focus-visible" || matches(selector),
    );

    // A right-click on the land header: the menu takes focus, so Space
    // never ticks a box.
    await contextMenu(sort("tiles"), 2);
    expect(menu()).not.toBeNull();
    expect(document.activeElement).toBe(menu());
    await contextMenu(sort("tiles"), 2);
    expect(menu()).toBeNull();

    // The context menu key on the gold header starts on the first box.
    gold.focus();
    await contextMenu(gold, 0);
    expect(document.activeElement).toBe(firstBox());

    sidebar.remove();
  });

  it("gives focus to the header row when the keyboard's header was unticked", async () => {
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
    sidebar.tick();
    const playerStats = sidebar.querySelector("player-stats") as PlayerStats;
    await playerStats.updateComplete;
    const picker = sidebar.querySelector("column-picker") as ColumnPicker;

    // The context menu key on the gold header, reached with the keyboard.
    const gold = playerStats.querySelector<HTMLElement>(
      '[role="columnheader"][data-column="gold"] button',
    )!;
    gold.focus();
    const matches = gold.matches.bind(gold);
    vi.spyOn(gold, "matches").mockImplementation(
      (selector) => selector === ":focus-visible" || matches(selector),
    );
    gold.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
    await picker.updateComplete;

    // Unticking gold takes its header away.
    [
      ...document.body.querySelectorAll<HTMLInputElement>(
        '[data-column-section="player"] input[type="checkbox"]',
      ),
    ]
      .find((box) => box.closest("label")?.dataset.column === "gold")
      ?.click();
    await playerStats.updateComplete;
    expect(gold.isConnected).toBe(false);

    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await picker.updateComplete;

    expect(document.body.querySelector("[data-column-menu]")).toBeNull();
    expect(document.activeElement).toBe(
      playerStats.querySelector(".stats-table-header button"),
    );
    expect(document.activeElement).not.toBe(document.body);

    sidebar.remove();
  });

  it("closes the column menu with the table it was opened for", async () => {
    const sidebar = new GameLeftSidebar();
    sidebar.game = ffaGame();
    sidebar.eventBus = new EventBus();
    document.body.append(sidebar);
    sidebar.init();
    await sidebar.updateComplete;
    const players = sidebar.querySelector<HTMLElement>(
      '[data-sidebar-button="players"]',
    );
    players?.click();
    await sidebar.updateComplete;
    sidebar
      .querySelector<HTMLElement>('[data-sidebar-button="columns"]')
      ?.click();
    const picker = sidebar.querySelector("column-picker") as ColumnPicker;
    await picker.updateComplete;
    expect(document.body.querySelector("[data-column-menu]")).not.toBeNull();

    players?.click();
    await sidebar.updateComplete;
    await picker.updateComplete;
    expect(document.body.querySelector("[data-column-menu]")).toBeNull();

    sidebar.remove();
  });

  it("gives the column menu the game ID for its footer, however it is opened", async () => {
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
    const columns = sidebar.querySelector<HTMLElement>(
      '[data-sidebar-button="columns"]',
    );
    const picker = sidebar.querySelector("column-picker") as ColumnPicker;
    const footer = () => document.body.querySelector("[data-menu-game-id]");

    // Both copies are in the page: which one shows is the stylesheet's call,
    // so it holds when the screen turns with the menu open.
    columns?.click();
    await picker.updateComplete;
    expect(footer()?.querySelector("[data-game-id]")?.textContent).toContain(
      "test-game",
    );
    columns?.click();
    await picker.updateComplete;
    expect(footer()).toBeNull();

    sidebar.querySelector("player-stats")?.dispatchEvent(
      new CustomEvent("columns-menu", {
        bubbles: true,
        detail: { x: 10, y: 10 },
      }),
    );
    await picker.updateComplete;
    expect(footer()?.querySelector("[data-game-id]")?.textContent).toContain(
      "test-game",
    );

    sidebar.remove();
  });

  it("opens and closes the leaderboard from its button, also while it closes", async () => {
    const sidebar = new GameLeftSidebar();
    sidebar.game = ffaGame();
    sidebar.eventBus = new EventBus();
    document.body.append(sidebar);
    sidebar.init();
    await sidebar.updateComplete;
    const button = sidebar.querySelector(
      '[data-sidebar-button="players"]',
    ) as HTMLElement;
    const playerStats = sidebar.querySelector("player-stats") as PlayerStats;
    const press = async () => {
      button.click();
      await sidebar.updateComplete;
    };

    // Without motion (as here, where nothing can animate) it flips at once.
    await press();
    expect(playerStats.visible).toBe(true);
    await press();
    expect(playerStats.visible).toBe(false);
    expect(button.getAttribute("aria-pressed")).toBe("false");

    // With motion, the tables stay until the closing has finished.
    const animations: { finish: () => void; reverse: () => void }[] = [];
    const aside = sidebar.querySelector("aside") as HTMLElement;
    Object.assign(aside, {
      animate: () => {
        let finish = () => {};
        const finished = new Promise<void>((resolve) => (finish = resolve));
        const animation = { finished, finish, reverse: vi.fn(finish) };
        animations.push(animation);
        return animation;
      },
    });
    await press();
    expect(playerStats.visible).toBe(true);
    await press();
    expect(playerStats.visible).toBe(true);
    animations[1].finish();
    await Promise.resolve();
    await sidebar.updateComplete;
    expect(playerStats.visible).toBe(false);

    // A press while it closes keeps it open.
    await press();
    await press();
    await press();
    expect(animations[3].reverse).toHaveBeenCalled();
    for (const animation of animations) animation.finish();
    await Promise.resolve();
    await sidebar.updateComplete;
    expect(playerStats.visible).toBe(true);
    expect(button.getAttribute("aria-pressed")).toBe("true");

    // A column menu opened while the panel closes goes with it.
    const menu = () => document.body.querySelector("[data-column-menu]");
    await press();
    sidebar
      .querySelector<HTMLElement>('[data-sidebar-button="columns"]')
      ?.click();
    await (sidebar.querySelector("column-picker") as ColumnPicker)
      .updateComplete;
    expect(menu()).not.toBeNull();
    for (const animation of animations) animation.finish();
    await Promise.resolve();
    await sidebar.updateComplete;
    await (sidebar.querySelector("column-picker") as ColumnPicker)
      .updateComplete;
    expect(playerStats.visible).toBe(false);
    expect(menu()).toBeNull();

    sidebar.remove();
  });

  it("leaves a team table that is closing closed when spawn ends", async () => {
    vi.stubGlobal("innerWidth", 1280);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
    }));
    let spawning = true;
    const sidebar = new GameLeftSidebar();
    sidebar.game = teamGame(() => spawning);
    sidebar.eventBus = new EventBus();
    document.body.append(sidebar);
    sidebar.init();
    await sidebar.updateComplete;
    const teams = sidebar.querySelector(
      '[data-sidebar-button="teams"]',
    ) as HTMLElement;
    const playerStats = sidebar.querySelector("player-stats") as PlayerStats;
    const teamStats = sidebar.querySelector("team-stats") as TeamStats;
    teams.click();
    await sidebar.updateComplete;
    expect(teamStats.visible).toBe(true);

    // The team table is closing when the spawn phase ends and the player
    // table opens by itself.
    let finish = () => {};
    Object.assign(sidebar.querySelector("aside") as HTMLElement, {
      animate: () => ({
        finished: new Promise<void>((resolve) => (finish = resolve)),
        reverse: () => finish(),
      }),
    });
    teams.click();
    await sidebar.updateComplete;
    spawning = false;
    sidebar.tick();
    finish();
    await Promise.resolve();
    await sidebar.updateComplete;

    expect(playerStats.visible).toBe(true);
    expect(teamStats.visible).toBe(false);

    sidebar.remove();
    vi.unstubAllGlobals();
  });

  it("keeps the player table short only while the team table is open", async () => {
    const sidebar = new GameLeftSidebar();
    sidebar.game = teamGame(() => false);
    sidebar.eventBus = new EventBus();
    document.body.append(sidebar);
    sidebar.init();
    await sidebar.updateComplete;
    const playerStats = sidebar.querySelector("player-stats") as PlayerStats;
    const press = async (name: string) => {
      sidebar
        .querySelector<HTMLElement>(`[data-sidebar-button="${name}"]`)
        ?.click();
      await sidebar.updateComplete;
    };

    await press("players");
    expect(playerStats.short).toBe(false);
    await press("teams");
    expect(playerStats.short).toBe(true);
    await press("teams");
    expect(playerStats.short).toBe(false);

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
