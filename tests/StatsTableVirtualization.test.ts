import { PlayerStats } from "../src/client/hud/layers/PlayerStats";
import type { GameView, PlayerView } from "../src/client/view";
import { UserSettings } from "../src/core/game/UserSettings";

function player(id: string, tiles: number): PlayerView {
  return {
    id: () => id,
    displayName: () => id,
    numTilesOwned: () => tiles,
    gold: () => BigInt(tiles),
    troops: () => tiles,
    totalUnitLevels: () => tiles,
    isAlive: () => true,
    isOnSameTeam: () => false,
  } as unknown as PlayerView;
}

function gameWith(players: PlayerView[], me: PlayerView | null): GameView {
  return {
    myPlayer: () => me,
    playerViews: () => players,
    config: () => ({ maxTroops: () => 100 }),
    numLandTiles: () => 100,
    numTilesWithFallout: () => 0,
  } as unknown as GameView;
}

async function mount(game: GameView): Promise<PlayerStats> {
  const playerStats = new PlayerStats();
  playerStats.game = game;
  playerStats.visible = true;
  document.body.append(playerStats);
  playerStats.refresh();
  await playerStats.updateComplete;
  return playerStats;
}

function scrollRows(el: PlayerStats): string[] {
  return [...el.querySelectorAll(".stats-table-scroll .stats-table-row")].map(
    (row) => row.textContent?.trim().split(/\s+/)[0] ?? "",
  );
}

// jsdom reports zero element sizes, so the component falls back to its
// defaults: 24px rows, 180px viewport, 4 overscan rows. The expected
// window is ceil(180 / 24) + 4 = 12 rows at scrollTop 0.
describe("StatsTable virtualization", () => {
  beforeEach(() => {
    localStorage.clear();
    (
      UserSettings as unknown as { cache: Map<string, string | null> }
    ).cache.clear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders only a window of rows for large player lists", async () => {
    const players = Array.from({ length: 300 }, (_, i) =>
      player(`p${i}`, 1000 - i),
    );
    const el = await mount(gameWith(players, null));

    expect(scrollRows(el)).toEqual(
      Array.from({ length: 12 }, (_, i) => `${i + 1}`),
    );
    const bottomSpacer = el.querySelector(
      ".stats-table-scroll .stats-table-spacer:last-child",
    );
    expect(bottomSpacer?.getAttribute("style")).toContain(
      `height: ${(300 - 12) * 24}px`,
    );

    el.remove();
  });

  it("reveals later rows with a top spacer when scrolled", async () => {
    const players = Array.from({ length: 300 }, (_, i) =>
      player(`p${i}`, 1000 - i),
    );
    const el = await mount(gameWith(players, null));

    const scroller = el.querySelector<HTMLElement>(".stats-table-scroll")!;
    scroller.scrollTop = 240;
    scroller.dispatchEvent(new Event("scroll"));
    await el.updateComplete;

    // first = floor(240/24) - 4 = 6; last = ceil((240+180)/24) + 4 = 22
    expect(scrollRows(el)).toEqual(
      Array.from({ length: 16 }, (_, i) => `${i + 7}`),
    );
    const topSpacer = scroller.querySelector(".stats-table-spacer");
    expect(topSpacer?.getAttribute("style")).toContain(`height: ${6 * 24}px`);

    el.remove();
  });

  it("renders the pinned row even when it is far outside the window", async () => {
    const players = Array.from({ length: 299 }, (_, i) =>
      player(`p${i}`, 1000 - i),
    );
    const me = player("me", 1);
    players.push(me);
    const el = await mount(gameWith(players, me));

    const pinned = el.querySelector(".stats-table-pinned-row");
    expect(pinned?.textContent).toContain("me");
    expect(pinned?.textContent?.trim().split(/\s+/)[0]).toBe("300");
    expect(scrollRows(el)).toEqual(
      Array.from({ length: 12 }, (_, i) => `${i + 1}`),
    );

    el.remove();
  });

  it("renders small lists fully without spacers", async () => {
    const players = Array.from({ length: 7 }, (_, i) =>
      player(`p${i}`, 100 - i),
    );
    const el = await mount(gameWith(players, null));

    expect(scrollRows(el)).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    expect(el.querySelector(".stats-table-spacer")).toBeNull();

    el.remove();
  });
});
