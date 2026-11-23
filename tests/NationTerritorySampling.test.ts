import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { randTerritoryTileArray } from "@openfront/engine/execution/nation/NationUtils";
import { createGame, L } from "./core/pathfinding/_fixtures";

describe("randTerritoryTileArray", () => {
  it("samples the territory as it is now", () => {
    const grid = Array(2000).fill(L);
    const game = createGame({ width: 100, height: 20, grid });
    const info = new PlayerInfo("p", PlayerType.Human, null, "p_id");
    const player = game.addPlayer(info);
    const conquerColumns = (from: number, to: number) =>
      game.map().forEachTile((tile) => {
        if (game.x(tile) >= from && game.x(tile) < to) player.conquer(tile);
      });
    const maxSampledX = () => {
      const random = new PseudoRandom(1);
      const tiles = randTerritoryTileArray(random, game, player, 40);
      return Math.max(...tiles.map((t) => game.x(t)));
    };

    conquerColumns(0, 10);
    expect(maxSampledX()).toBeLessThan(10);
    conquerColumns(10, 90);
    expect(maxSampledX()).toBeGreaterThanOrEqual(50);
  });
});
