// @vitest-environment jsdom
import { colord } from "colord";
import { PlayerStats } from "../src/client/hud/layers/PlayerStats";
import { UserSettings } from "../src/client/UserSettings";
import type { GameView, PlayerView } from "../src/client/view";

function player(id: string, tiles: number): PlayerView {
  return {
    id: () => id,
    smallID: () => 0,
    name: () => id,
    displayName: () => id,
    clanTag: () => null,
    numTilesOwned: () => tiles,
    gold: () => BigInt(tiles),
    tradeGold: () => 0,
    trainGold: () => 0,
    piracyGold: () => 0,
    goldEarned: () => 0,
    troops: () => tiles,
    totalUnitLevels: () => tiles,
    isAlive: () => true,
    isOnSameTeam: () => false,
    territoryColor: () => colord("#4a90d9"),
    incomingAttacks: () => [],
    isTraitor: () => false,
    isAlliedWith: () => false,
    hasEmbargoAgainst: () => false,
    isDisconnected: () => false,
  } as unknown as PlayerView;
}

function gameWith(players: PlayerView[], me: PlayerView | null): GameView {
  return {
    myPlayer: () => me,
    playerViews: () => players,
    config: () => ({ maxTroops: () => 100 }),
    ticks: () => 600,
    inSpawnPhase: () => false,
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

  it("draws your row even when it is far outside the window", async () => {
    const players = Array.from({ length: 299 }, (_, i) =>
      player(`p${i}`, 1000 - i),
    );
    const me = player("me", 1);
    players.push(me);
    const el = await mount(gameWith(players, me));

    const scroller = el.querySelector(".stats-table-scroll")!;
    const mine = scroller.querySelector("[data-me]");
    const above = scroller.querySelector("[data-near]");
    expect(mine?.textContent).toContain("me");
    expect(scrollRows(el)).toEqual([
      ...Array.from({ length: 12 }, (_, i) => `${i + 1}`),
      "299",
      "300",
    ]);
    // Rows 13 to 298 have no DOM: one spacer between the window and yours
    // with the row above it, none after them.
    const spacers = scroller.querySelectorAll(".stats-table-spacer");
    expect(spacers).toHaveLength(1);
    expect(spacers[0].getAttribute("style")).toContain(
      `height: ${(298 - 12) * 24}px`,
    );
    expect(spacers[0].nextElementSibling).toBe(above);
    expect(above?.nextElementSibling).toBe(mine);
    expect(mine?.nextElementSibling).toBeNull();

    el.remove();
  });

  it("keeps your row drawn when the list is scrolled past it", async () => {
    const me = player("me", 2000);
    const players = [
      me,
      ...Array.from({ length: 299 }, (_, i) => player(`p${i}`, 1000 - i)),
    ];
    const el = await mount(gameWith(players, me));

    const scroller = el.querySelector<HTMLElement>(".stats-table-scroll")!;
    scroller.scrollTop = 2400;
    scroller.dispatchEvent(new Event("scroll"));
    await el.updateComplete;

    // first = floor(2400/24) - 4 = 96; last = ceil((2400+180)/24) + 4 = 112
    const children = [...scroller.children];
    expect(children[0].hasAttribute("data-me")).toBe(true);
    expect(children[1].classList).toContain("stats-table-spacer");
    expect(children[1].getAttribute("style")).toContain(`height: ${95 * 24}px`);
    expect(scrollRows(el)).toEqual([
      "1",
      ...Array.from({ length: 16 }, (_, i) => `${i + 97}`),
    ]);

    el.remove();
  });

  it("sticks nothing when you have no row", async () => {
    const players = Array.from({ length: 300 }, (_, i) =>
      player(`p${i}`, 1000 - i),
    );
    const el = await mount(gameWith(players, null));

    expect(el.querySelector("[data-me]")).toBeNull();

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
