import {
  goldCoinIcon,
  guildIcon,
  profileIcon,
  soldierIcon,
  upperLimitIcon,
} from "../src/client/hud/HotbarIcons";
import { PlayerStats } from "../src/client/hud/layers/PlayerStats";
import { columnsFor } from "../src/client/hud/layers/lib/StatsColumns";
import type { GameView, PlayerView } from "../src/client/view";
import { UserSettings } from "../src/core/game/UserSettings";

function player(
  id: string,
  tiles: number,
  clanTag: string | null = null,
): PlayerView {
  return {
    id: () => id,
    smallID: () => 0,
    name: () => id,
    displayName: () => (clanTag === null ? id : `[${clanTag}] ${id}`),
    clanTag: () => clanTag,
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
  } as unknown as PlayerView;
}

describe("PlayerStats", () => {
  beforeEach(() => {
    localStorage.clear();
    (
      UserSettings as unknown as { cache: Map<string, string | null> }
    ).cache.clear();
  });

  it("locks rank, name, and picker while stat columns share spare width", async () => {
    const me = player("me", 3);
    const game = {
      myPlayer: () => me,
      playerViews: () => [me],
      config: () => ({ maxTroops: () => 100 }),
      ticks: () => 600,
      numLandTiles: () => 100,
      numTilesWithFallout: () => 0,
    } as unknown as GameView;
    const playerStats = new PlayerStats();
    playerStats.game = game;
    playerStats.visible = true;
    document.body.append(playerStats);

    playerStats.refresh();
    await playerStats.updateComplete;

    const content = playerStats.querySelector(".stats-table-content");
    expect(content?.classList).toContain("min-w-full");
    // Only selected stat tracks share definite spare space. Rank, the clan
    // column, name, and picker remain fixed and never stretch.
    expect(content?.getAttribute("style")).toContain(
      "34px 80px 100px auto auto auto 32px",
    );

    playerStats.remove();
  });

  it("keeps every player available without leaving a gap for the pinned row", async () => {
    const players = [
      player("one", 70),
      player("two", 60),
      player("three", 50),
      player("four", 40),
      player("five", 30),
      player("six", 20),
      player("me", 10),
    ];
    const game = {
      myPlayer: () => players[6],
      playerViews: () => players,
      config: () => ({ maxTroops: () => 100 }),
      ticks: () => 600,
      numLandTiles: () => 100,
      numTilesWithFallout: () => 0,
    } as unknown as GameView;
    const playerStats = new PlayerStats();
    playerStats.game = game;
    playerStats.visible = true;
    document.body.append(playerStats);

    playerStats.refresh();
    await playerStats.updateComplete;

    const scrollable = playerStats.querySelector(".stats-table-scroll");
    const pinned = playerStats.querySelector(".stats-table-pinned-row");
    const table = playerStats.querySelector(".stats-table");
    const picker = playerStats.querySelector("column-picker");
    expect(playerStats.querySelectorAll(".stats-table-row")).toHaveLength(7);
    expect(playerStats.children).toHaveLength(1);
    expect(picker?.closest(".stats-table")).toBe(table);
    expect(table?.querySelector(".stats-table-header")).not.toBeNull();
    const goldHeader = playerStats.querySelectorAll(
      '.stats-table-header > [role="columnheader"]',
    )[4];
    expect(goldHeader.querySelector("img")?.getAttribute("src")).toBe(
      goldCoinIcon,
    );
    expect(goldHeader.querySelector("button")?.getAttribute("aria-label")).toBe(
      "leaderboard.gold",
    );
    expect(scrollable).not.toBeNull();
    expect(pinned?.textContent).toContain("me");
    expect(scrollable?.contains(pinned)).toBe(false);
    expect(
      [...(scrollable?.querySelectorAll(".stats-table-row") ?? [])].map(
        (row) => row.textContent?.trim().split(/\s+/)[0],
      ),
    ).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(
      [...playerStats.querySelectorAll("button")].some((button) =>
        ["+", "-"].includes(button.textContent?.trim() ?? ""),
      ),
    ).toBe(false);

    playerStats.remove();
  });

  it("centers headers and discrete counts and renders white troop icons", async () => {
    new UserSettings().setStatsColumns("player", [
      "troops",
      "maxtroops",
      "cities",
    ]);
    const me = player("me", 3);
    const game = {
      myPlayer: () => me,
      playerViews: () => [me],
      config: () => ({ maxTroops: () => 100 }),
      ticks: () => 600,
      numLandTiles: () => 100,
      numTilesWithFallout: () => 0,
    } as unknown as GameView;
    const playerStats = new PlayerStats();
    playerStats.game = game;
    playerStats.visible = true;
    document.body.append(playerStats);

    playerStats.refresh();
    await playerStats.updateComplete;

    const headers = playerStats.querySelectorAll(
      '.stats-table-header > [role="columnheader"]',
    );
    const countCell = playerStats.querySelector(
      '.stats-table-row > [role="cell"]:nth-child(5)',
    );
    const troopIcon = headers[2].querySelector("img");
    const maxTroopIcons = headers[3].querySelectorAll("img");
    expect(headers[1].classList).toContain("justify-center");
    expect(headers[2].classList).toContain("justify-center");
    expect(headers[3].classList).toContain("justify-center");
    expect(headers[4].classList).toContain("justify-center");
    expect(troopIcon?.getAttribute("src")).toBe(soldierIcon);
    expect(troopIcon?.classList).toContain("brightness-0");
    expect(troopIcon?.classList).toContain("invert");
    // Max troops header reads as a troop icon raised to the upper-limit icon.
    expect(maxTroopIcons.length).toBe(2);
    expect(maxTroopIcons[0].getAttribute("src")).toBe(soldierIcon);
    expect(maxTroopIcons[0].classList).toContain("brightness-0");
    expect(maxTroopIcons[0].classList).toContain("invert");
    expect(maxTroopIcons[1].getAttribute("src")).toBe(upperLimitIcon);
    expect(maxTroopIcons[1].classList).toContain("brightness-0");
    expect(maxTroopIcons[1].classList).toContain("invert");
    expect(countCell?.classList).toContain("justify-center");
    expect(countCell?.classList).toContain("text-center");

    playerStats.remove();
  });
});

describe("PlayerStats clan column", () => {
  beforeEach(() => {
    localStorage.clear();
    (
      UserSettings as unknown as { cache: Map<string, string | null> }
    ).cache.clear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  async function mount(players: PlayerView[]): Promise<PlayerStats> {
    const game = {
      myPlayer: () => players[0],
      playerViews: () => players,
      config: () => ({ maxTroops: () => 100 }),
      ticks: () => 600,
      numLandTiles: () => 100,
      numTilesWithFallout: () => 0,
    } as unknown as GameView;
    const playerStats = new PlayerStats();
    playerStats.game = game;
    playerStats.visible = true;
    document.body.append(playerStats);
    playerStats.refresh();
    await playerStats.updateComplete;
    return playerStats;
  }

  it("shows the tag and the bare name in separate columns, without brackets", async () => {
    const playerStats = await mount([player("alice", 3, "ABCDE")]);

    const cells = playerStats.querySelectorAll(
      '.stats-table-row > [role="cell"]',
    );
    expect(cells[1].textContent?.trim()).toBe("ABCDE");
    expect(cells[2].textContent?.trim()).toBe("alice");
    // The merged "[ABCDE] alice" form must not survive into the table.
    expect(playerStats.textContent).not.toContain("[ABCDE]");
  });

  it("headers the clan column with the guild icon and reserves a fixed track", async () => {
    const playerStats = await mount([player("alice", 3, "ABCDE")]);

    const headers = playerStats.querySelectorAll(
      '.stats-table-header > [role="columnheader"]',
    );
    expect(headers[1].querySelector("img")?.getAttribute("src")).toBe(
      guildIcon,
    );
    expect(headers[1].getAttribute("title")).toBe("leaderboard.clan");
    expect(headers[2].querySelector("img")?.getAttribute("src")).toBe(
      profileIcon,
    );
    expect(
      playerStats.querySelector(".stats-table-content")?.getAttribute("style"),
    ).toContain("34px 80px 100px");
  });

  it("rules off every column but the first, so none read as merged", async () => {
    const playerStats = await mount([player("alice", 3, "ABCDE")]);

    const hasRule = (nodes: Element[]) =>
      nodes.map((node) => node.className.includes("border-l"));
    // rank | clan | player | tiles | gold | maxtroops (+ the ⚙️ track).
    expect(
      hasRule([
        ...playerStats.querySelectorAll(
          '.stats-table-header > [role="columnheader"]',
        ),
      ]),
    ).toEqual([false, true, true, true, true, true, true]);
    expect(
      hasRule([
        ...playerStats.querySelectorAll('.stats-table-row > [role="cell"]'),
      ]),
    ).toEqual([false, true, true, true, true, true]);
  });

  it("leaves an empty cell for clanless players", async () => {
    const playerStats = await mount([
      player("alice", 3, "ABCDE"),
      player("bob", 2),
    ]);

    const rows = playerStats.querySelectorAll(
      ".stats-table-scroll .stats-table-row",
    );
    expect(rows.length).toBe(2);
    expect(
      [...rows].map((row) =>
        row.querySelectorAll('[role="cell"]')[1].textContent?.trim(),
      ),
    ).toEqual(["ABCDE", ""]);
  });

  it("is on by default and disappears when deselected in the picker", async () => {
    const settings = new UserSettings();
    expect(settings.statsColumns("player")).toContain("clan");

    settings.setStatsColumns("player", ["tiles", "gold", "maxtroops"]);
    const playerStats = await mount([player("alice", 3, "ABCDE")]);

    expect(
      [
        ...playerStats.querySelectorAll(
          '.stats-table-header > [role="columnheader"]',
        ),
      ].map((header) => header.getAttribute("title")),
    ).not.toContain("leaderboard.clan");
    expect(
      playerStats.querySelector(".stats-table-content")?.getAttribute("style"),
    ).toContain("34px 100px");
    expect(playerStats.textContent).not.toContain("ABCDE");
  });

  it("gives only orderable columns a sort button", async () => {
    const playerStats = await mount([player("alice", 3, "ABCDE")]);

    const headers = [
      ...playerStats.querySelectorAll(
        '.stats-table-header > [role="columnheader"]',
      ),
    ];
    // rank, clan and player are not orderable; the stat tracks are.
    expect(
      headers
        .slice(0, 5)
        .map((header) => header.querySelector("button") !== null),
    ).toEqual([false, false, false, true, true]);
    expect(
      headers.slice(0, 4).map((header) => header.getAttribute("aria-sort")),
    ).toEqual([null, null, null, "descending"]);
  });

  it("survives being the only selected column, leaving the rows unsorted", async () => {
    new UserSettings().setStatsColumns("player", ["clan"]);
    const playerStats = await mount([
      player("alice", 3, "AAA"),
      player("bob", 90, "BBB"),
    ]);

    // rank | clan | player | picker — no stat track, so nothing to sort on.
    expect(
      playerStats.querySelector(".stats-table-content")?.getAttribute("style"),
    ).toContain("34px 80px 100px 32px");
    expect(
      [
        ...playerStats.querySelectorAll(".stats-table-scroll .stats-table-row"),
      ].map((row) =>
        row.querySelectorAll('[role="cell"]')[1].textContent?.trim(),
      ),
    ).toEqual(["AAA", "BBB"]);
  });
});

describe("TeamStats clan column", () => {
  beforeEach(() => {
    localStorage.clear();
    (
      UserSettings as unknown as { cache: Map<string, string | null> }
    ).cache.clear();
  });

  it("is not a team default, and a stored one still cannot render", () => {
    const settings = new UserSettings();
    expect(settings.statsColumns("team")).not.toContain("clan");

    // The clan def is player-only, so a hand-edited team selection carrying
    // it has nothing to match.
    settings.setStatsColumns("team", ["clan", "gold"]);
    expect(columnsFor("team").map((column) => column.id)).not.toContain("clan");
  });
});
