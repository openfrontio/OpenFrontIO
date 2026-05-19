/**
 * GameView is the client-side simulation mirror — it accumulates player /
 * unit / tile state from per-tick GameUpdateViewData. The FrameBuilder reads
 * the same accessors (players(), units(), tileStateBuffer(),
 * recentlyUpdatedTiles()) to translate state into FrameData each tick.
 *
 * These tests verify the update lifecycle: PlayerView reuse vs creation,
 * UnitView lifecycle (create / mutate / mark for deletion / sweep next tick),
 * smallID lookup, tick tracking, and tile delta accumulation.
 */

import { describe, expect, it } from "vitest";
import { UnitType } from "../../../src/core/game/Game";
import { GameUpdateType } from "../../../src/core/game/GameUpdates";
import {
  makeEmptyGu,
  makeGameView,
  makeNameViewData,
  makePlayerUpdate,
  makeUnitUpdate,
} from "../../util/viewStubs";

function withPlayers(
  tick: number,
  players: ReturnType<typeof makePlayerUpdate>[],
  nameDataMap: Record<string, ReturnType<typeof makeNameViewData>> = {},
) {
  const gu = makeEmptyGu(tick);
  gu.updates[GameUpdateType.Player] = players;
  for (const p of players) {
    gu.playerNameViewData[p.id] = nameDataMap[p.id] ?? makeNameViewData();
  }
  return gu;
}

describe("GameView.update — players", () => {
  it("creates a PlayerView for each player in the first tick", () => {
    const game = makeGameView();
    game.update(
      withPlayers(1, [
        makePlayerUpdate({ id: "alice", smallID: 1, name: "Alice" }),
        makePlayerUpdate({ id: "bob", smallID: 2, name: "Bob" }),
      ]),
    );
    expect(game.players().map((p) => p.id())).toEqual(["alice", "bob"]);
  });

  it("reuses an existing PlayerView on subsequent updates (in-place data swap)", () => {
    const game = makeGameView();
    game.update(
      withPlayers(1, [
        makePlayerUpdate({ id: "alice", smallID: 1, troops: 100 }),
      ]),
    );
    const first = game.player("alice");

    game.update(
      withPlayers(2, [
        makePlayerUpdate({ id: "alice", smallID: 1, troops: 250 }),
      ]),
    );
    const second = game.player("alice");

    expect(second).toBe(first); // same PlayerView instance
    expect(second.troops()).toBe(250); // data was swapped in
  });

  it("playerBySmallID resolves through the smallID → PlayerID map", () => {
    const game = makeGameView();
    game.update(
      withPlayers(1, [
        makePlayerUpdate({ id: "alice", smallID: 1 }),
        makePlayerUpdate({ id: "bob", smallID: 2 }),
      ]),
    );
    expect(
      (game.playerBySmallID(1) as ReturnType<typeof game.player>).id(),
    ).toBe("alice");
    expect(
      (game.playerBySmallID(2) as ReturnType<typeof game.player>).id(),
    ).toBe("bob");
  });

  it("playerBySmallID(0) returns a TerraNullius (used as the unowned-tile owner)", () => {
    const game = makeGameView();
    const terra = game.playerBySmallID(0);
    expect(terra.isPlayer()).toBe(false);
  });

  it("myPlayer() is resolved once the local player update arrives", () => {
    const game = makeGameView({ myClientID: "c-me" });
    expect(game.myPlayer()).toBeNull();

    game.update(
      withPlayers(1, [
        makePlayerUpdate({
          id: "me",
          smallID: 1,
          clientID: "c-me",
          name: "Me",
        }),
      ]),
    );
    expect(game.myPlayer()?.id()).toBe("me");
  });

  it("myPlayer() is cached — does not change identity across updates", () => {
    const game = makeGameView({ myClientID: "c-me" });
    game.update(
      withPlayers(1, [
        makePlayerUpdate({ id: "me", smallID: 1, clientID: "c-me" }),
      ]),
    );
    const first = game.myPlayer();
    game.update(
      withPlayers(2, [
        makePlayerUpdate({ id: "me", smallID: 1, clientID: "c-me" }),
      ]),
    );
    expect(game.myPlayer()).toBe(first);
  });

  it("local player's name is overridden with myUsername to bypass censorship", () => {
    const game = makeGameView({
      myClientID: "c-me",
      myUsername: "RealName",
    });
    game.update(
      withPlayers(1, [
        makePlayerUpdate({
          id: "me",
          smallID: 1,
          clientID: "c-me",
          name: "ServerName",
          displayName: "ServerName",
        }),
      ]),
    );
    expect(game.myPlayer()?.name()).toBe("RealName");
  });
});

describe("GameView.update — units", () => {
  it("creates a UnitView on first sighting and reuses it after", () => {
    const game = makeGameView();
    const gu1 = makeEmptyGu(1);
    gu1.updates[GameUpdateType.Unit] = [makeUnitUpdate({ id: 42, pos: 0 })];
    game.update(gu1);
    const first = game.unit(42);
    expect(first).toBeDefined();

    const gu2 = makeEmptyGu(2);
    gu2.updates[GameUpdateType.Unit] = [makeUnitUpdate({ id: 42, pos: 1 })];
    game.update(gu2);
    expect(game.unit(42)).toBe(first); // same instance
    expect(game.unit(42)?.tile()).toBe(1);
  });

  it("units() filters by type and returns only active units", () => {
    const game = makeGameView();
    const gu = makeEmptyGu(1);
    gu.updates[GameUpdateType.Unit] = [
      makeUnitUpdate({ id: 1, unitType: UnitType.City, isActive: true }),
      makeUnitUpdate({ id: 2, unitType: UnitType.Port, isActive: true }),
      makeUnitUpdate({ id: 3, unitType: UnitType.City, isActive: false }),
    ];
    game.update(gu);

    expect(
      game
        .units()
        .map((u) => u.id())
        .sort(),
    ).toEqual([1, 2]);
    expect(game.units(UnitType.City).map((u) => u.id())).toEqual([1]);
    // The inactive one is still present until the NEXT tick sweeps it.
    expect(game.unit(3)).toBeDefined();
  });

  it("inactive units are deleted on the following tick", () => {
    const game = makeGameView();

    const gu1 = makeEmptyGu(1);
    gu1.updates[GameUpdateType.Unit] = [
      makeUnitUpdate({ id: 7, isActive: true }),
    ];
    game.update(gu1);
    expect(game.unit(7)).toBeDefined();

    const gu2 = makeEmptyGu(2);
    gu2.updates[GameUpdateType.Unit] = [
      makeUnitUpdate({ id: 7, isActive: false }),
    ];
    game.update(gu2);
    // Still present on the tick they died (renderer can see deadUnit FX).
    expect(game.unit(7)).toBeDefined();

    const gu3 = makeEmptyGu(3);
    game.update(gu3);
    // Swept on the next tick.
    expect(game.unit(7)).toBeUndefined();
  });

  it("_wasUpdated resets to false at start of tick, then flips back on update", () => {
    const game = makeGameView();

    const gu1 = makeEmptyGu(1);
    gu1.updates[GameUpdateType.Unit] = [makeUnitUpdate({ id: 5 })];
    game.update(gu1);
    expect(game.unit(5)?.wasUpdated()).toBe(true);

    // Next tick — unit not in updates → wasUpdated should be false
    game.update(makeEmptyGu(2));
    expect(game.unit(5)?.wasUpdated()).toBe(false);

    // Next tick — unit reappears → wasUpdated true again
    const gu3 = makeEmptyGu(3);
    gu3.updates[GameUpdateType.Unit] = [makeUnitUpdate({ id: 5 })];
    game.update(gu3);
    expect(game.unit(5)?.wasUpdated()).toBe(true);
  });
});

describe("GameView.update — tile deltas", () => {
  it("recentlyUpdatedTiles() reflects refs in packedTileUpdates", () => {
    const game = makeGameView({ width: 4, height: 4 });
    const gu = makeEmptyGu(1);
    // packedTileUpdates is [tileRef, packedState, tileRef, packedState, ...]
    // packed state = (terrainByte << 16) | state — use 0 for both to keep tile
    // terrain-stable; we're just exercising the delta accumulator.
    gu.packedTileUpdates = new Uint32Array([2, 0, 5, 0, 9, 0]);
    game.update(gu);
    expect(game.recentlyUpdatedTiles().sort((a, b) => a - b)).toEqual([
      2, 5, 9,
    ]);
  });

  it("recentlyUpdatedTerrainTiles() only includes refs where terrain bytes changed", () => {
    const game = makeGameView({ width: 4, height: 4 });
    // Tile 3 starts with terrain byte 0. Pack a new terrain byte (0x80 = land)
    // for tile 3, and an unchanged terrain (0) for tile 7.
    const gu = makeEmptyGu(1);
    const TILE_3_PACKED = (0x80 << 16) | 0; // terrain changed
    const TILE_7_PACKED = 0; // terrain unchanged
    gu.packedTileUpdates = new Uint32Array([
      3,
      TILE_3_PACKED,
      7,
      TILE_7_PACKED,
    ]);
    game.update(gu);
    expect(game.recentlyUpdatedTiles().sort((a, b) => a - b)).toEqual([3, 7]);
    expect(game.recentlyUpdatedTerrainTiles()).toEqual([3]);
  });

  it("resets deltas to empty arrays each tick", () => {
    const game = makeGameView({ width: 4, height: 4 });
    const gu1 = makeEmptyGu(1);
    gu1.packedTileUpdates = new Uint32Array([1, 0]);
    game.update(gu1);
    expect(game.recentlyUpdatedTiles().length).toBe(1);

    // Empty next tick → empty deltas
    game.update(makeEmptyGu(2));
    expect(game.recentlyUpdatedTiles()).toEqual([]);
    expect(game.recentlyUpdatedTerrainTiles()).toEqual([]);
  });
});

describe("GameView.update — tick & lifecycle", () => {
  it("ticks() reflects the last update's tick", () => {
    const game = makeGameView();
    expect(game.ticks()).toBe(0); // before any update
    game.update(makeEmptyGu(42));
    expect(game.ticks()).toBe(42);
    game.update(makeEmptyGu(43));
    expect(game.ticks()).toBe(43);
  });

  it("inSpawnPhase() is true until a SpawnPhaseEnd update flips it off", () => {
    const game = makeGameView();
    expect(game.inSpawnPhase()).toBe(true);
    game.update(makeEmptyGu(5));
    expect(game.inSpawnPhase()).toBe(true);

    const gu = makeEmptyGu(10);
    gu.updates[GameUpdateType.SpawnPhaseEnd] = [
      { type: GameUpdateType.SpawnPhaseEnd, startTick: 10 } as ReturnType<
        typeof makeEmptyGu
      >["updates"][typeof GameUpdateType.SpawnPhaseEnd][number],
    ];
    game.update(gu);
    expect(game.inSpawnPhase()).toBe(false);
  });

  it("ticksSinceStart returns 0 during spawn phase, otherwise difference from startTick", () => {
    const game = makeGameView();
    expect(game.ticksSinceStart()).toBe(0); // spawn phase

    const gu1 = makeEmptyGu(10);
    gu1.updates[GameUpdateType.SpawnPhaseEnd] = [
      { type: GameUpdateType.SpawnPhaseEnd, startTick: 10 } as ReturnType<
        typeof makeEmptyGu
      >["updates"][typeof GameUpdateType.SpawnPhaseEnd][number],
    ];
    game.update(gu1);
    expect(game.ticksSinceStart()).toBe(0); // tick=10, start=10

    game.update(makeEmptyGu(15));
    expect(game.ticksSinceStart()).toBe(5);
  });
});

describe("GameView — accessors used by FrameBuilder", () => {
  it("width() / height() forward to the underlying map", () => {
    const game = makeGameView({ width: 12, height: 8 });
    expect(game.width()).toBe(12);
    expect(game.height()).toBe(8);
  });

  it("tileStateBuffer() returns a Uint16Array of width*height", () => {
    const game = makeGameView({ width: 5, height: 4 });
    const buf = game.tileStateBuffer();
    expect(buf).toBeInstanceOf(Uint16Array);
    expect(buf.length).toBe(20);
  });

  it("tileStateBuffer() is a live reference — mutated by update()", () => {
    const game = makeGameView({ width: 4, height: 4 });
    const buf = game.tileStateBuffer();
    const gu = makeEmptyGu(1);
    // Pack an owner ID into the low 12 bits of state for tile 6.
    gu.packedTileUpdates = new Uint32Array([6, 0x123]);
    game.update(gu);
    expect(buf[6] & 0xfff).toBe(0x123);
  });

  it("player(id) throws for unknown players (matches FrameBuilder's expectation)", () => {
    const game = makeGameView();
    expect(() => game.player("unknown")).toThrow();
  });

  it("config() returns the same Config instance passed in", () => {
    const game = makeGameView();
    expect(game.config()).toBe(game.config());
  });
});

describe("GameView.frameData() — renderer contract", () => {
  it("returns a stable object reference across ticks", () => {
    const game = makeGameView();
    game.update(makeEmptyGu(1));
    const f1 = game.frameData();
    game.update(makeEmptyGu(2));
    const f2 = game.frameData();
    expect(f2).toBe(f1);
  });

  it("frame.tileState is === gameView.tileStateBuffer() (zero-copy)", () => {
    const game = makeGameView({ width: 4, height: 4 });
    game.update(makeEmptyGu(1));
    expect(game.frameData().tileState).toBe(game.tileStateBuffer());
  });

  it("frame.changedTiles is null on the first populate (signals full upload)", () => {
    const game = makeGameView({ width: 4, height: 4 });
    const gu1 = makeEmptyGu(1);
    gu1.packedTileUpdates = new Uint32Array([1, 0, 2, 0]);
    game.update(gu1);
    expect(game.frameData().changedTiles).toBeNull();
  });

  it("frame.changedTiles becomes a delta array on subsequent populates", () => {
    const game = makeGameView({ width: 4, height: 4 });
    game.update(makeEmptyGu(1));

    const gu2 = makeEmptyGu(2);
    gu2.packedTileUpdates = new Uint32Array([3, 0, 5, 0, 9, 0]);
    game.update(gu2);
    const ct = game.frameData().changedTiles;
    expect(ct).not.toBeNull();
    expect(ct!.map((t) => t.ref).sort((a, b) => a - b)).toEqual([3, 5, 9]);
  });

  it("changedTiles scratch array is reused across ticks (no per-tick alloc)", () => {
    const game = makeGameView({ width: 4, height: 4 });
    game.update(makeEmptyGu(1)); // first populate (changedTiles = null)
    const gu2 = makeEmptyGu(2);
    gu2.packedTileUpdates = new Uint32Array([1, 0]);
    game.update(gu2);
    const ct1 = game.frameData().changedTiles;

    const gu3 = makeEmptyGu(3);
    gu3.packedTileUpdates = new Uint32Array([2, 0]);
    game.update(gu3);
    const ct2 = game.frameData().changedTiles;

    expect(ct2).toBe(ct1); // same array instance
  });

  it("frame.units is === gameView.unitStates() (same long-lived map)", () => {
    const game = makeGameView();
    game.update(makeEmptyGu(1));
    expect(game.frameData().units).toBe(game.unitStates());
  });

  it("frame.players is === gameView.playerStates() (same long-lived map)", () => {
    const game = makeGameView();
    game.update(makeEmptyGu(1));
    expect(game.frameData().players).toBe(game.playerStates());
  });

  it("frame.tick reflects the most recent gu.tick", () => {
    const game = makeGameView();
    game.update(makeEmptyGu(42));
    expect(game.frameData().tick).toBe(42);
    game.update(makeEmptyGu(43));
    expect(game.frameData().tick).toBe(43);
  });

  it("frame.events.deadUnits is populated from inactive Unit updates", () => {
    const game = makeGameView();
    const gu = makeEmptyGu(1);
    gu.updates[GameUpdateType.Unit] = [
      makeUnitUpdate({ id: 1, isActive: true, pos: 10 }),
      makeUnitUpdate({ id: 2, isActive: false, pos: 20 }),
      makeUnitUpdate({ id: 3, isActive: false, pos: 30 }),
    ];
    game.update(gu);
    const dead = game.frameData().events.deadUnits;
    expect(dead.length).toBe(2);
    expect(dead.map((d) => d.pos).sort((a, b) => a - b)).toEqual([20, 30]);
  });

  it("frame.events arrays are cleared each tick (no event leakage)", () => {
    const game = makeGameView();
    const gu1 = makeEmptyGu(1);
    gu1.updates[GameUpdateType.Unit] = [
      makeUnitUpdate({ id: 1, isActive: false }),
    ];
    game.update(gu1);
    expect(game.frameData().events.deadUnits.length).toBe(1);

    // Empty next tick → events cleared
    game.update(makeEmptyGu(2));
    expect(game.frameData().events.deadUnits.length).toBe(0);
  });

  it("frame.events.deadUnits array is reused (same reference)", () => {
    const game = makeGameView();
    game.update(makeEmptyGu(1));
    const a1 = game.frameData().events.deadUnits;
    game.update(makeEmptyGu(2));
    expect(game.frameData().events.deadUnits).toBe(a1);
  });

  it("frame.tileMode is 'live'", () => {
    const game = makeGameView();
    expect(game.frameData().tileMode).toBe("live");
  });

  it("frame.structuresDirty is true on first populate (force initial upload)", () => {
    const game = makeGameView();
    game.update(makeEmptyGu(1));
    expect(game.frameData().structuresDirty).toBe(true);
  });

  it("frame.structuresDirty resets between ticks when no structure changes", () => {
    const game = makeGameView();
    game.update(makeEmptyGu(1));
    game.update(makeEmptyGu(2));
    expect(game.frameData().structuresDirty).toBe(false);
  });
});
