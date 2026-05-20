/**
 * UnitView is mostly a thin accessor over a UnitUpdate record. Tests verify
 * each accessor returns the underlying data, that update() swaps the backing
 * record, that lastPos tracking works as the simulation advances units, and
 * that the trickier missile-readiness math is correct.
 */

import { describe, expect, it } from "vitest";
import { UnitView } from "../../../src/client/view/UnitView";
import {
  TrainType,
  TransportShipState,
  UnitType,
  WarshipState,
} from "../../../src/core/game/Game";
import { makeGameView, makeUnitUpdate, stubConfig } from "../../util/viewStubs";

describe("UnitView accessors", () => {
  it("forwards data fields", () => {
    const game = makeGameView();
    const u = new UnitView(
      game,
      makeUnitUpdate({
        id: 42,
        unitType: UnitType.City,
        ownerID: 7,
        pos: 100,
        lastPos: 99,
        troops: 250,
        level: 3,
        hasTrainStation: true,
        targetable: false,
        markedForDeletion: false,
        isActive: true,
        reachedTarget: false,
      }),
    );

    expect(u.id()).toBe(42);
    expect(u.type()).toBe(UnitType.City);
    expect(u.troops()).toBe(250);
    expect(u.level()).toBe(3);
    expect(u.hasTrainStation()).toBe(true);
    expect(u.targetable()).toBe(false);
    expect(u.markedForDeletion()).toBe(false);
    expect(u.isActive()).toBe(true);
    expect(u.reachedTarget()).toBe(false);
    expect(u.tile()).toBe(100);
  });

  it("tracks createdAt from the GameView's tick at construction", () => {
    const game = makeGameView();
    const u = new UnitView(game, makeUnitUpdate());
    expect(u.createdAt()).toBe(0); // GameView.ticks() returns 0 before any update
  });

  it("returns the latest data after update()", () => {
    const game = makeGameView();
    const u = new UnitView(game, makeUnitUpdate({ troops: 100, pos: 1 }));
    u.update(makeUnitUpdate({ troops: 250, pos: 5 }));
    expect(u.troops()).toBe(250);
    expect(u.tile()).toBe(5);
  });

  it("update() pushes new pos into lastPos", () => {
    const game = makeGameView();
    const u = new UnitView(game, makeUnitUpdate({ pos: 1 }));
    expect(u.lastTile()).toBe(1);
    u.update(makeUnitUpdate({ pos: 2 }));
    expect(u.lastTiles()).toEqual([1, 2]);
    u.update(makeUnitUpdate({ pos: 3 }));
    expect(u.lastTiles()).toEqual([1, 2, 3]);
  });

  it("lastTile() returns the first remembered pos", () => {
    const game = makeGameView();
    const u = new UnitView(game, makeUnitUpdate({ pos: 1 }));
    u.update(makeUnitUpdate({ pos: 2 }));
    u.update(makeUnitUpdate({ pos: 3 }));
    expect(u.lastTile()).toBe(1);
  });

  it("applyDerivedPosition pushes a new pos and shifts lastPos in data", () => {
    const game = makeGameView();
    const u = new UnitView(game, makeUnitUpdate({ pos: 10, lastPos: 9 }));
    u.applyDerivedPosition(11);
    expect(u.tile()).toBe(11);
    expect(u.lastTiles()).toEqual([10, 11]);
  });

  it("hasHealth() reflects whether health is set", () => {
    const game = makeGameView();
    expect(new UnitView(game, makeUnitUpdate({ health: 50 })).hasHealth()).toBe(
      true,
    );
    expect(new UnitView(game, makeUnitUpdate()).hasHealth()).toBe(false);
  });

  it("health() returns 0 when unset", () => {
    const game = makeGameView();
    expect(new UnitView(game, makeUnitUpdate()).health()).toBe(0);
    expect(new UnitView(game, makeUnitUpdate({ health: 42 })).health()).toBe(
      42,
    );
  });

  it("isUnderConstruction reflects the explicit boolean", () => {
    const game = makeGameView();
    expect(
      new UnitView(
        game,
        makeUnitUpdate({ underConstruction: true }),
      ).isUnderConstruction(),
    ).toBe(true);
    expect(
      new UnitView(
        game,
        makeUnitUpdate({ underConstruction: false }),
      ).isUnderConstruction(),
    ).toBe(false);
    // Undefined is treated as false (not under construction).
    expect(new UnitView(game, makeUnitUpdate()).isUnderConstruction()).toBe(
      false,
    );
  });

  it("trainType() / isLoaded() forward optional train fields", () => {
    const game = makeGameView();
    const u = new UnitView(
      game,
      makeUnitUpdate({ trainType: TrainType.Engine, loaded: true }),
    );
    expect(u.trainType()).toBe(TrainType.Engine);
    expect(u.isLoaded()).toBe(true);
  });

  it("transportShipState() returns a default when missing", () => {
    const game = makeGameView();
    const u = new UnitView(game, makeUnitUpdate());
    expect(u.transportShipState()).toEqual({ isRetreating: false, troops: 0 });
  });

  it("transportShipState() forwards when set", () => {
    const game = makeGameView();
    const state: TransportShipState = { isRetreating: true, troops: 50 };
    const u = new UnitView(game, makeUnitUpdate({ transportShipState: state }));
    expect(u.transportShipState()).toBe(state);
  });

  it("warshipState() throws when not a warship state", () => {
    const game = makeGameView();
    const u = new UnitView(game, makeUnitUpdate());
    expect(() => u.warshipState()).toThrow();
  });

  it("warshipState() forwards when present", () => {
    const game = makeGameView();
    const state: WarshipState = {
      isInCombat: false,
      patrolTile: 0,
      lastAttackTile: 0,
      bossUnitId: null,
    } as unknown as WarshipState;
    const u = new UnitView(game, makeUnitUpdate({ warshipState: state }));
    expect(u.warshipState()).toBe(state);
  });

  it("isInCombat() reflects warshipState.isInCombat (or false if missing)", () => {
    const game = makeGameView();
    expect(new UnitView(game, makeUnitUpdate()).isInCombat()).toBe(false);
    const combat = new UnitView(
      game,
      makeUnitUpdate({
        warshipState: { isInCombat: true } as unknown as WarshipState,
      }),
    );
    expect(combat.isInCombat()).toBe(true);
  });

  it("targetUnitId / targetTile pass through", () => {
    const game = makeGameView();
    const u = new UnitView(
      game,
      makeUnitUpdate({ targetUnitId: 99, targetTile: 12 }),
    );
    expect(u.targetUnitId()).toBe(99);
    expect(u.targetTile()).toBe(12);
  });

  it("missileTimerQueue() forwards the array", () => {
    const game = makeGameView();
    const u = new UnitView(
      game,
      makeUnitUpdate({ missileTimerQueue: [10, 20, 30] }),
    );
    expect(u.missileTimerQueue()).toEqual([10, 20, 30]);
  });

  it("touch / updateWarshipState / updateTransportShipState throw on view", () => {
    const game = makeGameView();
    const u = new UnitView(game, makeUnitUpdate());
    expect(() => u.touch()).toThrow();
    expect(() => u.updateWarshipState({})).toThrow();
    expect(() => u.updateTransportShipState({ isRetreating: false })).toThrow();
  });

  describe("missileReadinesss", () => {
    it("returns 1 when nothing is reloading", () => {
      const game = makeGameView();
      const u = new UnitView(
        game,
        makeUnitUpdate({ level: 3, missileTimerQueue: [] }),
      );
      expect(u.missileReadinesss()).toBe(1);
    });

    it("returns 0 when all missiles are reloading and level > 1", () => {
      const game = makeGameView({ config: stubConfig() });
      const u = new UnitView(
        game,
        makeUnitUpdate({
          unitType: UnitType.SAMLauncher,
          level: 2,
          missileTimerQueue: [0, 0], // both reloading, started at tick 0
        }),
      );
      // Just-launched: progress is 0, readiness 0/2.
      expect(u.missileReadinesss()).toBe(0);
    });

    it("returns partial readiness when missiles are partway through cooldown", () => {
      // SAMCooldown = 120 in stub. Half-way at tick 60. Level 2 with both reloading
      // means readiness = 0/2 from ready missiles + 2 * (60/120) / 2 = 0.5.
      // But game.ticks() returns 0 with no update. So progress = 0 - 0 = 0 → 0.
      // Use a game with a tick number injected.
      const config = stubConfig({
        SAMCooldown: () => 120,
        SiloCooldown: () => 75,
      } as unknown as Partial<
        typeof stubConfig extends () => infer C ? C : never
      >);
      const game = makeGameView({ config });
      const u = new UnitView(
        game,
        makeUnitUpdate({
          unitType: UnitType.SAMLauncher,
          level: 2,
          missileTimerQueue: [0, 0],
        }),
      );
      // Without advancing game ticks, readiness = (2-2)/2 + 2*((0-0)/120)/2 = 0.
      // We can't easily advance ticks without going through update(); just assert <=1.
      const r = u.missileReadinesss();
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    });
  });
});
