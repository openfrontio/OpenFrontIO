import { describe, expect, test } from "vitest";
import { RisingSeaLevelExecution } from "../../../src/core/execution/RisingSeaLevelExecution";
import { Game, Player, PlayerType } from "../../../src/core/game/Game";
import { TileRef } from "../../../src/core/game/GameMap";
import { playerInfo, setup } from "../../util/Setup";
import { expectSnapshotRoundTrip } from "../../util/Snapshot";

// The only small fixture with both a coastline and land to take: 16x16, 134
// land tiles. plains/big_plains have no water at all, so nothing would flood.
const MAP = "ocean_and_land";
const FIRST_FLOOD_TICK = 180 * 10;

async function floodGame(): Promise<{
  game: Game;
  exec: RisingSeaLevelExecution;
  player: Player;
}> {
  const game = await setup(
    MAP,
    { risingSeaLevel: { enabled: true, speed: "veryfast" } },
    [playerInfo("owner", PlayerType.Human)],
  );
  const player = game.player("owner");
  // Owned land as well as neutral land, so the snapshot covers relinquish and
  // the pending queue, not just terrain edits.
  game.forEachTile((t: TileRef) => {
    if (game.isLand(t) && !game.isImpassable(t) && !game.hasOwner(t)) {
      player.conquer(t);
    }
  });
  const exec = new RisingSeaLevelExecution();
  game.addExecution(exec);
  return { game, exec, player };
}

function run(game: Game, ticks: number): void {
  for (let i = 0; i < ticks; i++) game.executeNextTick();
}

describe("rising sea level snapshots", () => {
  test("during the grace, with the front seeded and nothing flooded", async () => {
    const { game, exec } = await floodGame();
    run(game, 100);
    expect(exec.flooded()).toBe(0);
    expect(exec.reachable()).toBeGreaterThan(100);
    // A second execution that has not been init'd yet is snapshotted too.
    game.addExecution(new RisingSeaLevelExecution());
    await expectSnapshotRoundTrip(game, MAP, 30);
  }, 60_000);

  test("mid-flood, with a partly consumed bucket and tiles in flight", async () => {
    const { game, exec } = await floodGame();
    const before = game.numLandTiles();
    // Land in the middle of a flood second, so the bucket has a consumed prefix
    // and the previous second's conversions are still unconfirmed. This is the
    // phase that catches a front that snapshots its consumed history.
    run(game, FIRST_FLOOD_TICK + 40 * 10 + 3);
    expect(exec.isActive()).toBe(true);
    expect(exec.flooded()).toBeGreaterThan(0);
    expect(game.numLandTiles()).toBeLessThan(before);
    await expectSnapshotRoundTrip(game, MAP, 60);
  }, 60_000);

  test("after termination, with the map already flooded", async () => {
    const { game, exec } = await floodGame();
    run(game, FIRST_FLOOD_TICK + 900 * 10);
    expect(exec.isActive()).toBe(false);
    expect(game.numLandTiles()).toBeGreaterThan(0);
    await expectSnapshotRoundTrip(game, MAP, 30);
  }, 120_000);
});
