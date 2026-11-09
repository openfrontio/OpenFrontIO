import {
  Cell,
  GameMode,
  Nation,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import { NationExecution } from "@openfront/engine/execution/NationExecution";
import { GameImpl } from "@openfront/engine/game/GameImpl";
import { createGame, L } from "./core/pathfinding/_fixtures";

describe("Nation spawns with team spawn areas", () => {
  // 100x100 land: the nation's team spawns in the west half, the other team in the east half
  function spawnNation(spawnCell: Cell) {
    const size = 100;
    const game = createGame(
      { width: size, height: size, grid: Array(size * size).fill(L) },
      { gameMode: GameMode.Team, playerTeams: 2 },
      {
        "2": [
          { x: 0, y: 0, width: 50, height: size },
          { x: 50, y: 0, width: 50, height: size },
        ],
      },
    );
    const info = new PlayerInfo("nation", PlayerType.Nation, null, "nation");
    // teams()[0] is the bot team
    const nation = (game as GameImpl).addPlayer(info, game.teams()[1]);
    game.addExecution(new NationExecution("game", new Nation(spawnCell, info)));
    for (let i = 0; i < 10 && !nation.hasSpawned(); i++) game.executeNextTick();
    expect(game.inSpawnPhase()).toBe(true);
    expect(nation.hasSpawned()).toBe(true);
    return { game, tiles: Array.from(nation.tiles()) };
  }

  it("spawns inside its team's area when its map spot lies outside it", () => {
    const { game, tiles } = spawnNation(new Cell(80, 50));
    expect(tiles.every((t) => game.x(t) < 50)).toBe(true);
  });

  it("keeps its map spot when that lies inside its team's area", () => {
    const { game, tiles } = spawnNation(new Cell(20, 50));
    const spot = game.ref(20, 50);
    expect(
      tiles.every((t) => game.euclideanDistSquared(t, spot) <= 30 ** 2),
    ).toBe(true);
  });
});
