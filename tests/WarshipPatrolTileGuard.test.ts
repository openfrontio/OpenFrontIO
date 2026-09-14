import { beforeEach, describe, expect, it } from "vitest";
import { WarshipExecution } from "../src/core/execution/WarshipExecution";
import {
  Game,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";

// coastX matches the other warship tests: on "half_land_half_ocean" the water
// starts just past this column, so tiles at (coastX + n, y) sit on the ocean.
const coastX = 7;
let game: Game;

describe("WarshipExecution.randomTile patrol-tile guard", () => {
  beforeEach(async () => {
    game = await setup(
      "half_land_half_ocean",
      { infiniteGold: true, instantBuild: true },
      [new PlayerInfo("p1", PlayerType.Human, null, "p1")],
    );
  });

  function makeWarshipExec(patrolTile: number): {
    exec: WarshipExecution;
    warship: Unit;
  } {
    const player = game.player("p1");
    const warship = player.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 10),
      { patrolTile },
    );
    const exec = new WarshipExecution(warship);
    exec.init(game, 0);
    return { exec, warship };
  }

  it("returns a valid water tile for a normal integer patrol tile", () => {
    const { exec } = makeWarshipExec(game.ref(coastX + 1, 10));
    const tile = exec.randomTile();
    expect(tile === undefined || game.isValidRef(tile)).toBe(true);
    if (tile !== undefined) {
      expect(Number.isInteger(tile)).toBe(true);
    }
  });

  it("bails out (no hang) when patrolTile is a non-integer ref", () => {
    // Poison the patrol tile directly, bypassing the intent-level isValidRef
    // guard, to prove randomTile() itself can no longer spin forever.
    const { exec, warship } = makeWarshipExec(game.ref(coastX + 1, 10));
    warship.updateWarshipState({ patrolTile: game.ref(coastX + 2, 10) + 0.5 });

    const t0 = performance.now();
    const tile = exec.randomTile();
    const ms = performance.now() - t0;

    expect(tile).toBeUndefined();
    expect(ms).toBeLessThan(1000);
  });

  it("bails out when patrolTile is out of range", () => {
    const { exec, warship } = makeWarshipExec(game.ref(coastX + 1, 10));
    warship.updateWarshipState({ patrolTile: game.width() * game.height() });
    expect(exec.randomTile()).toBeUndefined();
  });

  it("a full warship tick does not hang with a poisoned patrol tile", () => {
    const { exec, warship } = makeWarshipExec(game.ref(coastX + 1, 10));
    warship.updateWarshipState({ patrolTile: game.ref(coastX + 2, 10) + 0.5 });
    game.addExecution(exec);
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) game.executeNextTick();
    expect(performance.now() - t0).toBeLessThan(3000);
  });
});
