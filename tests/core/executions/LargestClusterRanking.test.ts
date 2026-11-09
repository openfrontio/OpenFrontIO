import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { PlayerExecution } from "@openfront/engine/execution/PlayerExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { beforeEach, describe, expect, test } from "vitest";
import { setup } from "../../util/Setup";

// removeClusters picks the player's main border cluster by the 4-way
// territory area behind each cluster, and publishes its bounding box as
// largestClusterBoundingBox (name placement, nation targeting). These pin
// that ranking on shapes the area flood has to get exactly right.
function rankClusters(game: Game, player: Player) {
  const exec = new PlayerExecution(player);
  exec.init(game, 0);
  (exec as unknown as { removeClusters(): void }).removeClusters();
  const box = player.largestClusterBoundingBox;
  return box === null
    ? null
    : { minX: box.min.x, minY: box.min.y, maxX: box.max.x, maxY: box.max.y };
}

let game: Game;
let player: Player;

describe("largest cluster ranking", () => {
  beforeEach(async () => {
    game = await setup("big_plains", {}, [
      new PlayerInfo("player", PlayerType.Human, "client1", "player_id"),
    ]);
    player = game.player("player_id");
  });

  const fill = (x0: number, y0: number, x1: number, y1: number) => {
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) player.conquer(game.ref(x, y));
    }
  };

  test("a lone territory's box is its own", () => {
    fill(10, 30, 19, 39);
    expect(rankClusters(game, player)).toEqual({
      minX: 10,
      minY: 30,
      maxX: 19,
      maxY: 39,
    });
  });

  test("a winding territory outranks a smaller straight one by area", () => {
    // Serpentine of 111 tiles: three rows joined at alternating ends, so
    // the flood has to turn back on itself twice to count it all.
    fill(10, 10, 40, 10);
    fill(40, 11, 40, 19);
    fill(10, 20, 40, 20);
    fill(10, 21, 10, 29);
    fill(10, 30, 40, 30);
    // A separate straight strip of 110 tiles with the wider box: it only
    // wins if the serpentine is undercounted.
    fill(0, 60, 109, 60);
    expect(rankClusters(game, player)).toEqual({
      minX: 10,
      minY: 10,
      maxX: 40,
      maxY: 30,
    });
  });

  test("a comb outranks a smaller block", () => {
    // Back at the bottom, teeth pointing up: every tooth is its own run in
    // the rows above the back. 6*31 + 3*5*25 = 561 tiles.
    fill(10, 35, 40, 40);
    fill(10, 10, 14, 34);
    fill(22, 10, 26, 34);
    fill(36, 10, 40, 34);
    // 20 x 28 = 560 tiles, one fewer.
    fill(100, 100, 119, 127);
    expect(rankClusters(game, player)).toEqual({
      minX: 10,
      minY: 10,
      maxX: 40,
      maxY: 40,
    });
  });

  test("a ring is ranked by its outer edge, not the rim of its hole", () => {
    fill(10, 10, 30, 30);
    for (let x = 18; x <= 22; x++) {
      for (let y = 18; y <= 22; y++) player.relinquish(game.ref(x, y));
    }
    expect(rankClusters(game, player)).toEqual({
      minX: 10,
      minY: 10,
      maxX: 30,
      maxY: 30,
    });
  });
});
