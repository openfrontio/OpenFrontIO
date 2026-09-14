import { describe, expect, it } from "vitest";
import { SpawnExecution } from "../../../src/core/execution/SpawnExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
} from "../../../src/core/game/Game";
import { TileRef } from "../../../src/core/game/GameMap";
import { canBuildTransportShip } from "../../../src/core/game/TransportShipUtils";
import { createGame, L, W } from "../pathfinding/_fixtures";

function addPlayer(game: Game, tile: TileRef, id: string = "test"): Player {
  const info = new PlayerInfo(id, PlayerType.Human, null, `${id}_id`);
  game.addPlayer(info);
  game.addExecution(new SpawnExecution("game_id", info, tile));
  game.executeNextTick();
  game.executeNextTick();
  return game.player(info.id);
}

// Target island (cols 10-24, rows 1-16) with an interior lake
// (cols 15-20, rows 6-11) enclosed by a thick land moat, so the lake is a
// separate water component from the ocean. Attacker island on the left.
function buildLakeMap(): Game {
  const width = 26;
  const height = 18;
  const grid: string[] = new Array(width * height).fill(W);
  const set = (x: number, y: number, v: string) => (grid[y * width + x] = v);
  const inBox = (
    x: number,
    y: number,
    x0: number,
    x1: number,
    y0: number,
    y1: number,
  ) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (inBox(x, y, 1, 5, 6, 11)) set(x, y, L); // attacker island
      if (inBox(x, y, 10, 24, 1, 16)) set(x, y, L); // target island (unowned)
      if (inBox(x, y, 15, 20, 6, 11)) set(x, y, W); // carve lake
    }
  }
  return createGame({ width, height, grid });
}

describe("canBuildTransportShip", () => {
  it("allows a transport toward a reachable ocean shore near a lake click", () => {
    const game = buildLakeMap();
    const attacker = addPlayer(game, game.ref(3, 8), "attacker");

    // Click on the (unowned) target island next to the inland lake. The nearest
    // owned shore is lake-facing and unreachable by the attacker's boats, but a
    // reachable ocean-facing shore exists — so the boat must still be buildable.
    const clickNearLake = game.ref(14, 8);
    const src = canBuildTransportShip(game, attacker, clickNearLake);

    expect(src).not.toBe(false);
    expect(game.isShore(src as TileRef)).toBe(true);
    expect((attacker as Player).smallID()).toBe(game.ownerID(src as TileRef));
  });
});
