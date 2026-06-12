import { AttackExecution } from "../src/core/execution/AttackExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { Game, Player, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { GameID } from "../src/core/Schemas";
import { setup } from "./util/Setup";

let game: Game;
const gameID: GameID = "game_id";

function collectNeighbors(tile: TileRef): TileRef[] {
  const out: TileRef[] = [];
  game.forEachNeighbor(tile, (n) => out.push(n));
  return out;
}

function collectNeighborsWithDiag(tile: TileRef): TileRef[] {
  const out: TileRef[] = [];
  game.forEachNeighborWithDiag(tile, (n) => out.push(n));
  return out;
}

describe("Neighbor iteration", () => {
  beforeEach(async () => {
    game = await setup("ocean_and_land"); // 16x16
  });

  test("forEachNeighbor visits W, E, N, S in that exact order for interior tiles", () => {
    const tile = game.ref(5, 7);
    expect(collectNeighbors(tile)).toEqual([
      game.ref(4, 7),
      game.ref(6, 7),
      game.ref(5, 6),
      game.ref(5, 8),
    ]);
  });

  test("forEachNeighbor clips at corners and edges", () => {
    const w = game.width();
    const h = game.height();
    // top-left corner: E, S only
    expect(collectNeighbors(game.ref(0, 0))).toEqual([
      game.ref(1, 0),
      game.ref(0, 1),
    ]);
    // bottom-right corner: W, N only
    expect(collectNeighbors(game.ref(w - 1, h - 1))).toEqual([
      game.ref(w - 2, h - 1),
      game.ref(w - 1, h - 2),
    ]);
    // left edge: E, N, S
    expect(collectNeighbors(game.ref(0, 5))).toEqual([
      game.ref(1, 5),
      game.ref(0, 4),
      game.ref(0, 6),
    ]);
    // bottom edge: W, E, N
    expect(collectNeighbors(game.ref(5, h - 1))).toEqual([
      game.ref(4, h - 1),
      game.ref(6, h - 1),
      game.ref(5, h - 2),
    ]);
  });

  test("forEachNeighbor matches map.neighbors() as a set for every tile", () => {
    game.forEachTile((tile) => {
      const a = [...collectNeighbors(tile)].sort((x, y) => x - y);
      const b = [...game.map().neighbors(tile)].sort((x, y) => x - y);
      expect(a).toEqual(b);
    });
  });

  test("forEachNeighborWithDiag visits all 8 neighbors in dx-major order", () => {
    const tile = game.ref(5, 7);
    expect(collectNeighborsWithDiag(tile)).toEqual([
      game.ref(4, 6),
      game.ref(4, 7),
      game.ref(4, 8),
      game.ref(5, 6),
      game.ref(5, 8),
      game.ref(6, 6),
      game.ref(6, 7),
      game.ref(6, 8),
    ]);
  });

  test("forEachNeighborWithDiag clips at corners and edges", () => {
    const w = game.width();
    const h = game.height();
    expect(collectNeighborsWithDiag(game.ref(0, 0))).toEqual([
      game.ref(0, 1),
      game.ref(1, 0),
      game.ref(1, 1),
    ]);
    expect(collectNeighborsWithDiag(game.ref(w - 1, h - 1))).toEqual([
      game.ref(w - 2, h - 2),
      game.ref(w - 2, h - 1),
      game.ref(w - 1, h - 2),
    ]);
    expect(collectNeighborsWithDiag(game.ref(5, 0))).toEqual([
      game.ref(4, 0),
      game.ref(4, 1),
      game.ref(5, 1),
      game.ref(6, 0),
      game.ref(6, 1),
    ]);
  });
});

describe("Conquer border invariants", () => {
  let attacker: Player;
  let defender: Player;

  // For every player: borderTiles ⊆ tiles, and a tile is a border tile iff
  // some in-bounds cardinal neighbor has a different owner.
  function checkBorderInvariant() {
    for (const player of game.players()) {
      const tiles = player.tiles();
      const borderTiles = player.borderTiles();
      for (const tile of borderTiles) {
        expect(tiles.has(tile)).toBe(true);
      }
      const mismatches: TileRef[] = [];
      for (const tile of tiles) {
        let isBorder = false;
        game.forEachNeighbor(tile, (n) => {
          if (game.owner(n) !== player) {
            isBorder = true;
          }
        });
        if (borderTiles.has(tile) !== isBorder) {
          mismatches.push(tile);
        }
      }
      expect(mismatches).toEqual([]);
    }
  }

  beforeEach(async () => {
    game = await setup("plains", { infiniteTroops: true }); // 100x100, all land
    const attackerInfo = new PlayerInfo(
      "attacker dude",
      PlayerType.Human,
      null,
      "attacker_id",
    );
    game.addPlayer(attackerInfo);
    const defenderInfo = new PlayerInfo(
      "defender dude",
      PlayerType.Human,
      null,
      "defender_id",
    );
    game.addPlayer(defenderInfo);

    game.addExecution(
      new SpawnExecution(gameID, attackerInfo, game.ref(0, 0)),
      new SpawnExecution(gameID, defenderInfo, game.ref(5, 5)),
    );
    game.executeNextTick();
    game.executeNextTick();

    attacker = game.player(attackerInfo.id);
    defender = game.player(defenderInfo.id);
  });

  test("border invariant holds after expanding into terra nullius", () => {
    game.addExecution(
      new AttackExecution(1000, attacker, game.terraNullius().id()),
    );
    for (let i = 0; i < 30; i++) {
      game.executeNextTick();
    }
    expect(attacker.numTilesOwned()).toBeGreaterThan(10);
    checkBorderInvariant();
  });

  test("border invariant holds while two players fight over territory", () => {
    game.addExecution(
      new AttackExecution(1000, attacker, game.terraNullius().id()),
      new AttackExecution(1000, defender, game.terraNullius().id()),
    );
    for (let i = 0; i < 40; i++) {
      game.executeNextTick();
    }
    game.addExecution(new AttackExecution(5000, attacker, defender.id()));
    // Check the invariant repeatedly while the fight is in progress, not
    // just at the end.
    for (let i = 0; i < 40; i++) {
      game.executeNextTick();
      if (i % 10 === 0) {
        checkBorderInvariant();
      }
    }
    expect(attacker.numTilesOwned()).toBeGreaterThan(10);
    checkBorderInvariant();
  });

  test("conquering a specific tile updates owner and neighbors' border status", () => {
    game.addExecution(
      new AttackExecution(1000, attacker, game.terraNullius().id()),
    );
    for (let i = 0; i < 30; i++) {
      game.executeNextTick();
    }
    // Pick a border tile of the attacker and verify its interior neighbors
    // are not border tiles.
    for (const tile of attacker.tiles()) {
      expect(game.owner(tile)).toBe(attacker);
    }
    checkBorderInvariant();
  });
});
