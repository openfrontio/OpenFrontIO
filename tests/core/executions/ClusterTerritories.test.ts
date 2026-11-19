import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { PlayerExecution } from "@openfront/engine/execution/PlayerExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { beforeEach, describe, expect, test } from "vitest";
import { setup } from "../../util/Setup";

// The pinch pass tells a hole's rim from a separate enclave by the 8-way
// territory each border cluster belongs to (checkAndAssignTerritory). These
// pin that grouping on shapes held together only by diagonal steps.
interface TerritoryProbe {
  clusterTerritoryIds: Int32Array | null;
  initClusterTerritories(clusters: number[][]): void;
  checkAndAssignTerritory(clusters: number[][], a: number, b: number): void;
}

let game: Game;
let player: Player;

describe("cluster territories", () => {
  beforeEach(async () => {
    game = await setup("big_plains", {}, [
      new PlayerInfo("player", PlayerType.Human, "client1", "player_id"),
    ]);
    player = game.player("player_id");
  });

  const own = (cells: [number, number][]) =>
    cells.map(([x, y]) => {
      const t = game.ref(x, y);
      player.conquer(t);
      return t;
    });

  // Assigns territories starting from cluster `from` and returns each
  // cluster's id
  function territories(clusters: number[][], from: number, to: number) {
    const exec = new PlayerExecution(player);
    exec.init(game, 0);
    const probe = exec as unknown as TerritoryProbe;
    probe.initClusterTerritories(clusters);
    probe.clusterTerritoryIds![to] = 99;
    probe.checkAndAssignTerritory(clusters, to, from);
    return Array.from(probe.clusterTerritoryIds!);
  }

  // A staircase that steps one tile sideways per row, with a run at each end
  const staircase = (dx: 1 | -1) =>
    own([
      [50, 10],
      [51, 10],
      [52, 10],
      ...Array.from(
        { length: 8 },
        (_, i) => [50 + dx * (i + 1), 11 + i] as [number, number],
      ),
    ]);

  test.each([
    ["down-left", -1],
    ["down-right", 1],
  ] as const)(
    "a staircase stepping %s is one territory from either end",
    (_, dx) => {
      const tiles = staircase(dx);
      const top = [tiles[0], tiles[1], tiles[2]];
      const bottom = [tiles[tiles.length - 1]];
      const apart = own([[150, 150]]);
      const clusters = [top, bottom, apart];
      for (const [from, to] of [
        [0, 1],
        [1, 0],
      ]) {
        const ids = territories(clusters, from, to);
        expect(ids[0]).toBe(ids[1]);
        expect(ids[0]).not.toBe(-1);
        expect(ids[2]).toBe(-1);
      }
    },
  );

  // Row-major refs put the end of one row next to the start of the next:
  // (w-1, y) and (0, y+2) are diagonal neighbors there, but not on the map.
  test("the fill doesn't wrap around the map's edges", () => {
    const w = game.width();
    const [left, right] = own([
      [0, 21],
      [w - 1, 19],
    ]);
    for (const [from, to] of [
      [0, 1],
      [1, 0],
    ]) {
      const ids = territories([[left], [right]], from, to);
      expect(ids[to]).toBe(99);
      expect(ids[from]).not.toBe(99);
    }
  });
});
