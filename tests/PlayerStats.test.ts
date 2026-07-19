import { goldCoinIcon, soldierIcon } from "../src/client/hud/HotbarIcons";
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
    // Only selected stat tracks share definite spare space. Rank, name, and
    // picker remain fixed and never participate in stretching.
    expect(content?.getAttribute("style")).toContain(
      "30px 100px auto auto auto 32px",
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
    )[3];
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
    const maxTroopIcon = headers[3].querySelector("img");
    expect(headers[1].classList).toContain("justify-center");
    expect(headers[2].classList).toContain("justify-center");
    expect(headers[3].classList).toContain("justify-center");
    expect(headers[4].classList).toContain("justify-center");
    expect(troopIcon?.getAttribute("src")).toBe(soldierIcon);
    expect(troopIcon?.classList).toContain("brightness-0");
    expect(troopIcon?.classList).toContain("invert");
    expect(headers[3].textContent).toContain("Max");
    expect(maxTroopIcon?.getAttribute("src")).toBe(soldierIcon);
    expect(maxTroopIcon?.classList).toContain("brightness-0");
    expect(maxTroopIcon?.classList).toContain("invert");
    expect(countCell?.classList).toContain("justify-center");
    expect(countCell?.classList).toContain("text-center");

    playerStats.remove();
  });
});
