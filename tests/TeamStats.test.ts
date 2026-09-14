import { columnById } from "../src/client/hud/layers/lib/StatsColumns";
import {
  aggregateTeamValues,
  TeamStats,
} from "../src/client/hud/layers/TeamStats";
import type { GameView, PlayerView } from "../src/client/view";
import { PlayerType } from "../src/core/game/Game";
import { UserSettings } from "../src/core/game/UserSettings";
import { playerInfo, setup } from "./util/Setup";

describe("aggregateTeamValues", () => {
  it("sums values for alive players only", async () => {
    const game = await setup("plains", {}, [
      playerInfo("alive", PlayerType.Human),
      playerInfo("other-alive", PlayerType.Human),
      playerInfo("dead", PlayerType.Human),
    ]);
    const alivePlayer = game.player("alive");
    const otherAlivePlayer = game.player("other-alive");
    const deadPlayer = game.player("dead");

    for (let x = 0; x < 12; x++) alivePlayer.conquer(game.ref(x, 0));
    for (let x = 0; x < 8; x++) otherAlivePlayer.conquer(game.ref(x, 1));
    alivePlayer.addGold(50n);
    otherAlivePlayer.addGold(30n);
    deadPlayer.addGold(100n);

    expect(
      Object.fromEntries(
        aggregateTeamValues(
          game.allPlayers() as unknown as PlayerView[],
          [columnById("tiles"), columnById("gold")],
          game as unknown as GameView,
        ),
      ),
    ).toEqual({ tiles: 20, gold: 80 });
  });

  it("skips columns that have no number behind them", async () => {
    const game = await setup("plains", {}, [
      playerInfo("alive", PlayerType.Human),
    ]);
    game.player("alive").conquer(game.ref(0, 0));

    expect(
      Object.fromEntries(
        aggregateTeamValues(
          game.allPlayers() as unknown as PlayerView[],
          [columnById("rank"), columnById("player"), columnById("tiles")],
          game as unknown as GameView,
        ),
      ),
    ).toEqual({ tiles: 1 });
  });
});

describe("TeamStats", () => {
  beforeEach(() => {
    localStorage.clear();
    (
      UserSettings as unknown as { cache: Map<string, string | null> }
    ).cache.clear();
  });

  it("renders team ranks with the shared stats table", async () => {
    const players = [
      {
        id: () => "blue-player",
        smallID: () => 0,
        team: () => "Blue",
        numTilesOwned: () => 10,
        gold: () => 10n,
        tradeGold: () => 0,
        trainGold: () => 0,
        piracyGold: () => 0,
        goldEarned: () => 0,
        isAlive: () => true,
      },
      {
        id: () => "red-player",
        smallID: () => 1,
        team: () => "Red",
        numTilesOwned: () => 5,
        gold: () => 20n,
        tradeGold: () => 0,
        trainGold: () => 0,
        piracyGold: () => 0,
        goldEarned: () => 0,
        isAlive: () => true,
      },
    ] as unknown as PlayerView[];
    const game = {
      myPlayer: () => players[0],
      playerViews: () => players,
      config: () => ({ maxTroops: () => 100 }),
      ticks: () => 600,
      numLandTiles: () => 100,
      numTilesWithFallout: () => 0,
    } as unknown as GameView;
    const teamStats = new TeamStats();
    teamStats.game = game;
    teamStats.visible = true;
    document.body.append(teamStats);

    teamStats.refresh();
    await teamStats.updateComplete;

    const table = teamStats.querySelector(".stats-table");
    const picker = teamStats.querySelector("column-picker");
    const rowCells = teamStats.querySelectorAll(
      '.stats-table-row > [role="cell"]',
    );
    expect(teamStats.children).toHaveLength(1);
    expect(picker?.closest(".stats-table")).toBe(table);
    expect(table?.querySelector(".stats-table-header")).not.toBeNull();
    expect(rowCells[0]?.textContent?.trim()).toBe("1");
    expect(rowCells[1]?.textContent?.trim()).toContain("Blue");

    const headers = teamStats.querySelectorAll(
      '.stats-table-header > [role="columnheader"]',
    );
    (headers[3].querySelector("button") as HTMLButtonElement).click();
    await teamStats.updateComplete;
    expect(
      teamStats.querySelectorAll('.stats-table-row > [role="cell"]')[1]
        ?.textContent,
    ).toContain("Red");

    teamStats.remove();
  });
});
