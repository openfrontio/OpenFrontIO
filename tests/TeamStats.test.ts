// @vitest-environment jsdom
import { PlayerType } from "@openfront/engine-api/game/GameTypes";
import { colord } from "colord";
import { columnById } from "../src/client/hud/layers/lib/StatsColumns";
import {
  aggregateTeamValues,
  TeamStats,
} from "../src/client/hud/layers/TeamStats";
import { themeProvider } from "../src/client/theme/ThemeProvider";
import { UserSettings } from "../src/client/UserSettings";
import type { GameView, PlayerView } from "../src/client/view";
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
      inSpawnPhase: () => false,
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
    const rowCells = teamStats.querySelectorAll(
      '.stats-table-row > [role="cell"]',
    );
    expect(teamStats.children).toHaveLength(1);
    expect(table?.querySelector("column-picker")).toBeNull();
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

  it("marks your team's row, and none for a spectator", async () => {
    const players = ["Blue", "Red"].map((team, i) => ({
      id: () => `${team}-player`,
      smallID: () => i,
      team: () => team,
      numTilesOwned: () => 10 - i,
      gold: () => 10n,
      isAlive: () => true,
    })) as unknown as PlayerView[];
    const mount = async (me: PlayerView | null) => {
      const teamStats = new TeamStats();
      teamStats.game = {
        myPlayer: () => me,
        playerViews: () => players,
        config: () => ({ maxTroops: () => 100 }),
        ticks: () => 600,
        inSpawnPhase: () => false,
        numLandTiles: () => 100,
        numTilesWithFallout: () => 0,
      } as unknown as GameView;
      teamStats.visible = true;
      document.body.append(teamStats);
      teamStats.refresh();
      await teamStats.updateComplete;
      return [...teamStats.querySelectorAll(".stats-table-row")].map((row) =>
        row.hasAttribute("data-me"),
      );
    };

    expect(await mount(players[1])).toEqual([false, true]);
    expect(await mount(null)).toEqual([false, false]);

    document.body.innerHTML = "";
  });

  it("is named apart from the player table", async () => {
    const players = [
      {
        id: () => "blue-player",
        smallID: () => 0,
        team: () => "Blue",
        numTilesOwned: () => 10,
        gold: () => 10n,
        isAlive: () => true,
      },
    ] as unknown as PlayerView[];
    const teamStats = new TeamStats();
    teamStats.game = {
      myPlayer: () => null,
      playerViews: () => players,
      config: () => ({ maxTroops: () => 100 }),
      ticks: () => 600,
      inSpawnPhase: () => false,
      numLandTiles: () => 100,
      numTilesWithFallout: () => 0,
    } as unknown as GameView;
    teamStats.visible = true;
    document.body.append(teamStats);
    teamStats.refresh();
    await teamStats.updateComplete;

    const table = teamStats.querySelector('[role="table"]');
    expect(table?.getAttribute("aria-label")).toBe("leaderboard.teams_table");
    expect(table?.getAttribute("aria-rowcount")).toBe("2");

    teamStats.remove();
  });

  it("shows each team's colour and how many of its players are alive", async () => {
    const players = [
      ["Blue", true, 10],
      ["Blue", true, 10],
      ["Blue", false, 0],
      ["Red", false, 0],
    ].map(([team, alive, tiles], i) => ({
      id: () => `player-${i}`,
      smallID: () => i,
      team: () => team,
      numTilesOwned: () => tiles,
      gold: () => 10n,
      isAlive: () => alive,
    })) as unknown as PlayerView[];
    const teamStats = new TeamStats();
    teamStats.game = {
      myPlayer: () => null,
      playerViews: () => players,
      config: () => ({ maxTroops: () => 100 }),
      ticks: () => 600,
      inSpawnPhase: () => false,
      numLandTiles: () => 100,
      numTilesWithFallout: () => 0,
    } as unknown as GameView;
    teamStats.visible = true;
    document.body.append(teamStats);
    teamStats.refresh();
    await teamStats.updateComplete;

    const [blue, red] = [...teamStats.querySelectorAll(".stats-table-row")].map(
      (row) => row.querySelector('[data-column="team"]') as HTMLElement,
    );
    const chip = blue.querySelector("[data-chip]") as HTMLElement;
    expect(blue.firstElementChild).toBe(chip);
    expect(colord(chip.style.background).toHex()).toBe(
      themeProvider.current().teamColor("Blue").toHex(),
    );

    // After the name, named for a screen reader and on hover.
    const alive = blue.querySelector("[data-alive]") as HTMLElement;
    expect(blue.lastElementChild).toBe(alive);
    expect(alive.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "leaderboard.players_alive 2/3",
    );
    expect(alive.title).toBe("leaderboard.players_alive 2/3");
    expect(alive.hasAttribute("data-zero")).toBe(false);

    // A team with nobody left stays, its count dimmed like its zeros.
    const none = red.querySelector("[data-alive]") as HTMLElement;
    expect(none.title).toBe("leaderboard.players_alive 0/1");
    expect(none.hasAttribute("data-zero")).toBe(true);

    teamStats.remove();
  });

  it("renders clan tag team name when teamClanTag is present", async () => {
    const players = [
      {
        id: () => "player-1",
        smallID: () => 0,
        team: () => "Team 16",
        numTilesOwned: () => 10,
        gold: () => 10n,
        tradeGold: () => 0,
        trainGold: () => 0,
        piracyGold: () => 0,
        goldEarned: () => 0,
        isAlive: () => true,
      },
      {
        id: () => "player-2",
        smallID: () => 1,
        team: () => "Team 17",
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
      inSpawnPhase: () => false,
      numLandTiles: () => 100,
      numTilesWithFallout: () => 0,
      teamClanTag: (team: string) => {
        if (team === "Team 16") return "AST2";
        if (team === "Team 17") return "BRV";
        return null;
      },
    } as unknown as GameView;
    const teamStats = new TeamStats();
    teamStats.game = game;
    teamStats.visible = true;
    document.body.append(teamStats);

    teamStats.refresh();
    await teamStats.updateComplete;

    const rows = teamStats.querySelectorAll(".stats-table-row");
    expect(rows).toHaveLength(2);
    const row1Cells = rows[0].querySelectorAll('[role="cell"]');
    const row2Cells = rows[1].querySelectorAll('[role="cell"]');
    expect(row1Cells[1]?.textContent?.trim()).toContain("[AST2]");
    expect(row2Cells[1]?.textContent?.trim()).toContain("[BRV]");

    teamStats.remove();
  });
});
