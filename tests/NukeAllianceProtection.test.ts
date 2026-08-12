import { describe, expect, it } from "vitest";
import { NukeMagnitude } from "../src/core/configuration/Config";
import { MirvExecution } from "../src/core/execution/MIRVExecution";
import { NukeExecution } from "../src/core/execution/NukeExecution";
import { AllianceRequestImpl } from "../src/core/game/AllianceRequestImpl";
import { PlayerInfo, PlayerType, UnitType } from "../src/core/game/Game";
import { GameImpl } from "../src/core/game/GameImpl";
import { PlayerImpl } from "../src/core/game/PlayerImpl";
import { setup } from "./util/Setup";
import { TestConfig } from "./util/TestConfig";

class ProtectionTestConfig extends TestConfig {
  nukeAllianceBreakThreshold(): number {
    return 5;
  }
  spawnImmunityDuration(): number {
    return 0;
  }
  nukeMagnitudes(unitType: UnitType): NukeMagnitude {
    switch (unitType) {
      case UnitType.AtomBomb:
        return { inner: 8, outer: 10 };
      case UnitType.MIRVWarhead:
      case UnitType.MIRV:
        return { inner: 8, outer: 10 };
      case UnitType.HydrogenBomb:
        return { inner: 10, outer: 20 };
    }
    return { inner: 4, outer: 10 };
  }
}

describe("Nuke & MIRV Alliance Protection", () => {
  async function setupTestGame() {
    const game = (await setup(
      "plains",
      { instantBuild: true, infiniteGold: true },
      [
        new PlayerInfo("player1", PlayerType.Human, "c1", "p1"),
        new PlayerInfo("player2", PlayerType.Human, "c2", "p2"),
        new PlayerInfo("player3", PlayerType.Human, "c3", "p3"),
      ],
      undefined,
      ProtectionTestConfig,
    )) as GameImpl;

    const p1 = game.player("p1") as PlayerImpl;
    const p2 = game.player("p2") as PlayerImpl;
    const p3 = game.player("p3") as PlayerImpl;

    p1.conquer(game.ref(0, 0));
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        p2.conquer(game.ref(5 + dx, 5 + dy));
        p3.conquer(game.ref(10 + dx, 10 + dy));
      }
    }

    // Build structures for players and mark construction complete
    const silo = p1.buildUnit(UnitType.MissileSilo, game.ref(0, 0), {});
    silo.setUnderConstruction(false);

    const c2 = p2.buildUnit(UnitType.City, game.ref(5, 5), {});
    c2.setUnderConstruction(false);

    const c3 = p3.buildUnit(UnitType.City, game.ref(10, 10), {});
    c3.setUnderConstruction(false);

    return { game, p1, p2, p3 };
  }

  it("blocks nuke launch at fresh ally on first attempt and allows on second attempt", async () => {
    const { game, p1, p2 } = await setupTestGame();

    // Form an alliance between p1 and p2 at current tick
    const req = new AllianceRequestImpl(p1, p2, game.ticks(), game);
    game.acceptAllianceRequest(req);

    const alliance = p1.allianceWith(p2);
    expect(alliance).not.toBeNull();
    expect(alliance?.missileProtectionUsed(p1)).toBe(false);

    // Target a tile owned by p2 (city tile at 5, 5)
    const targetTile = game.ref(5, 5);

    // First launch attempt: AtomBomb
    const exec1 = new NukeExecution(UnitType.AtomBomb, p1, targetTile);
    game.addExecution(exec1);
    game.executeNextTick(); // init
    game.executeNextTick(); // tick (protection check triggers, sets active = false)

    // Should be blocked: exec1 inactive, protection used, alliance intact
    expect(exec1.isActive()).toBe(false);
    expect(alliance?.missileProtectionUsed(p1)).toBe(true);
    expect(p1.allianceWith(p2)).not.toBeNull();

    // Second launch attempt: AtomBomb (protection already used)
    const exec2 = new NukeExecution(UnitType.AtomBomb, p1, targetTile);
    game.addExecution(exec2);
    game.executeNextTick(); // init
    game.executeNextTick(); // tick (builds nuke & breaks alliance)

    // Should proceed: exec2 active, nuke unit spawned, alliance broken
    expect(exec2.isActive()).toBe(true);
    expect(p1.allianceWith(p2)).toBeNull();
  });

  it("grants independent 1-time protection for both players in the alliance", async () => {
    const { game, p1, p2 } = await setupTestGame();

    // Alliance created at tick 0
    const req = new AllianceRequestImpl(p1, p2, game.ticks(), game);
    game.acceptAllianceRequest(req);

    const alliance = p1.allianceWith(p2);
    expect(alliance?.missileProtectionUsed(p1)).toBe(false);
    expect(alliance?.missileProtectionUsed(p2)).toBe(false);

    // Player 1 launches at Player 2 -> blocked for p1
    const targetTileP2 = game.ref(5, 5);
    const execP1 = new NukeExecution(UnitType.AtomBomb, p1, targetTileP2);
    game.addExecution(execP1);
    game.executeNextTick();
    game.executeNextTick();

    expect(execP1.isActive()).toBe(false);
    expect(alliance?.missileProtectionUsed(p1)).toBe(true);
    expect(alliance?.missileProtectionUsed(p2)).toBe(false);
    expect(p1.allianceWith(p2)).not.toBeNull();

    // Now Player 2 launches at Player 1 -> should ALSO be blocked for p2 on 1st attempt
    const targetTileP1 = game.ref(1, 1);
    const execP2 = new NukeExecution(UnitType.AtomBomb, p2, targetTileP1);
    game.addExecution(execP2);
    game.executeNextTick();
    game.executeNextTick();

    expect(execP2.isActive()).toBe(false);
    expect(alliance?.missileProtectionUsed(p2)).toBe(true);
    expect(p1.allianceWith(p2)).not.toBeNull();
  });

  it("blocks MIRV launch targeting direct fresh ally on first attempt and allows on second attempt", async () => {
    const { game, p1, p2 } = await setupTestGame();

    // Form alliance
    const req = new AllianceRequestImpl(p1, p2, game.ticks(), game);
    game.acceptAllianceRequest(req);
    const alliance = p1.allianceWith(p2);

    const targetTile = game.ref(5, 5);

    // First MIRV launch attempt directly targeting p2
    const mirv1 = new MirvExecution(p1, targetTile);
    game.addExecution(mirv1);
    game.executeNextTick(); // init (protection check triggers in init(), sets active = false)

    // Should be blocked: mirv1 inactive, protection used, alliance intact
    expect(mirv1.isActive()).toBe(false);
    expect(alliance?.missileProtectionUsed(p1)).toBe(true);
    expect(p1.allianceWith(p2)).not.toBeNull();

    // Second MIRV launch attempt directly targeting p2
    const mirv2 = new MirvExecution(p1, targetTile);
    game.addExecution(mirv2);
    game.executeNextTick(); // init (breaks alliance in init())
    game.executeNextTick(); // tick (builds MIRV)

    // Should proceed: mirv2 active, alliance broken
    expect(mirv2.isActive()).toBe(true);
    expect(p1.allianceWith(p2)).toBeNull();
  });

  it("does NOT block MIRV when targeting a tile near a fresh ally if the fresh ally is not direct tile owner", async () => {
    const { game, p1, p2 } = await setupTestGame();

    // Alliance between p1 and p2
    const req = new AllianceRequestImpl(p1, p2, game.ticks(), game);
    game.acceptAllianceRequest(req);

    // Target p3 tile (p2 is nearby collateral)
    const targetTile = game.ref(10, 10);

    const mirv = new MirvExecution(p1, targetTile);
    game.addExecution(mirv);
    game.executeNextTick(); // init
    game.executeNextTick(); // tick

    // MIRV should NOT be blocked by p2's alliance since p3 is direct target
    expect(mirv.isActive()).toBe(true);
    expect(p1.allianceWith(p2)).not.toBeNull();
  });

  it("allows nuke launch after protection duration expires (6 ticks)", async () => {
    const { game, p1, p2 } = await setupTestGame();

    const req = new AllianceRequestImpl(p1, p2, game.ticks(), game);
    game.acceptAllianceRequest(req);

    // Fast-forward ticks by 6 (> 5 tick protection window)
    for (let i = 0; i < 6; i++) {
      game.executeNextTick();
    }

    const targetTile = game.ref(5, 5);
    const exec = new NukeExecution(UnitType.AtomBomb, p1, targetTile);
    game.addExecution(exec);
    game.executeNextTick(); // init
    game.executeNextTick(); // tick

    // Should proceed and break alliance without protection trigger
    expect(exec.isActive()).toBe(true);
    expect(p1.allianceWith(p2)).toBeNull();
  });

  it("blocks nuke launch at fresh ally based on tile count threshold when no structures exist", async () => {
    const { game, p1, p2 } = await setupTestGame();

    // Conquer structure-free territory for p2 at (50, 50) (9 tiles > threshold 5)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        p2.conquer(game.ref(50 + dx, 50 + dy));
      }
    }

    // Build a silo for p1 near (50, 50) so launch range is satisfied
    const silo2 = p1.buildUnit(UnitType.MissileSilo, game.ref(45, 50), {});
    silo2.setUnderConstruction(false);

    // Form alliance
    const req = new AllianceRequestImpl(p1, p2, game.ticks(), game);
    game.acceptAllianceRequest(req);
    const alliance = p1.allianceWith(p2);

    // Target unowned tile (48, 50) adjacent to p2's territory
    const targetTile = game.ref(48, 50);

    // Launch attempt 1: AtomBomb targeting neutral tile near p2 territory
    const exec1 = new NukeExecution(UnitType.AtomBomb, p1, targetTile);
    game.addExecution(exec1);
    game.executeNextTick(); // init
    game.executeNextTick(); // tick

    // Blocked based purely on tile count threshold (9.0 weight > 5 threshold)
    expect(exec1.isActive()).toBe(false);
    expect(alliance?.missileProtectionUsed(p1)).toBe(true);
    expect(p1.allianceWith(p2)).not.toBeNull();

    // Launch attempt 2: AtomBomb targeting same neutral tile
    const exec2 = new NukeExecution(UnitType.AtomBomb, p1, targetTile);
    game.addExecution(exec2);
    game.executeNextTick(); // init
    game.executeNextTick(); // tick

    // Proceeds and breaks alliance
    expect(exec2.isActive()).toBe(true);
    expect(p1.allianceWith(p2)).toBeNull();
  });

  it("does NOT block nuke launch at fresh ally when tile count is below threshold and no structures exist", async () => {
    const { game, p1, p2 } = await setupTestGame();

    // Conquer only 2 structure-free tiles for p2 at (60, 60) (2 tiles <= threshold 5)
    p2.conquer(game.ref(60, 60));
    p2.conquer(game.ref(60, 61));

    // Build a silo for p1 near (60, 60)
    const silo3 = p1.buildUnit(UnitType.MissileSilo, game.ref(55, 60), {});
    silo3.setUnderConstruction(false);

    // Form alliance
    const req = new AllianceRequestImpl(p1, p2, game.ticks(), game);
    game.acceptAllianceRequest(req);

    // Target unowned tile (58, 60) adjacent to p2's 2 tiles
    const targetTile = game.ref(58, 60);

    const exec = new NukeExecution(UnitType.AtomBomb, p1, targetTile);
    game.addExecution(exec);
    game.executeNextTick(); // init
    game.executeNextTick(); // tick

    // Should NOT trigger protection (2 tiles <= 5 threshold); proceeds without breaking alliance
    expect(exec.isActive()).toBe(true);
    expect(p1.allianceWith(p2)).not.toBeNull();
  });
});
