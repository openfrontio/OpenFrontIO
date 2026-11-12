// @vitest-environment jsdom
import { GameMode } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { GameLeftSidebar } from "../src/client/hud/layers/GameLeftSidebar";
import type { PlayerStats } from "../src/client/hud/layers/PlayerStats";
import type { TeamStats } from "../src/client/hud/layers/TeamStats";
import { AlternateViewEvent } from "../src/client/InputHandler";
import { UserSettings } from "../src/client/UserSettings";
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

    (sidebar.querySelector('[role="button"]') as HTMLElement).click();
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
      "max-[400px]:mt-[calc(var(--bar-offset)+var(--game-health-offset,0px))]";
    const offsetHeight =
      "max-[400px]:max-h-[calc(100vh-80px-var(--game-health-offset,0px))]";
    expect(aside().classList).not.toContain(offsetMargin);
    expect(aside().classList).not.toContain(offsetHeight);
    expect(aside().style.marginTop).toBe("");
    expect(aside().style.getPropertyValue("--bar-offset")).toBe("0px");

    (sidebar.querySelector('[role="button"]') as HTMLElement).click();
    await sidebar.updateComplete;
    expect(aside().classList).toContain(offsetMargin);
    expect(aside().classList).toContain(offsetHeight);

    (sidebar.querySelector('[role="button"]') as HTMLElement).click();
    await sidebar.updateComplete;
    expect(aside().classList).not.toContain(offsetMargin);
    expect(aside().classList).not.toContain(offsetHeight);
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
      sidebar.querySelector<HTMLElement>("[aria-pressed]") as HTMLElement;
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
});
