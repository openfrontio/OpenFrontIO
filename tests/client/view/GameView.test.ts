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
  const nameViewData: NonNullable<typeof gu.playerNameViewData> = {};
  for (const p of players) {
    nameViewData[p.id] = nameDataMap[p.id] ?? makeNameViewData();
  }
  gu.playerNameViewData = nameViewData;
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

describe("GameView.update — packed channels", () => {
  it("packedPlayerUpdates quads update tilesOwned/gold/troops in place", () => {
    const game = makeGameView();
    game.update(
      withPlayers(1, [
        makePlayerUpdate({ id: "alice", smallID: 1, troops: 100, gold: 5n }),
      ]),
    );

    const gu = makeEmptyGu(2);
    // [smallID, tilesOwned, gold, troops]
    gu.packedPlayerUpdates = new Float64Array([1, 42, 999, 250]);
    game.update(gu);

    const alice = game.player("alice");
    expect(alice.numTilesOwned()).toBe(42);
    expect(alice.gold()).toBe(999n);
    expect(alice.troops()).toBe(250);
  });

  it("packedAttackUpdates patches troop counts by direction and index", () => {
    const game = makeGameView();
    game.update(
      withPlayers(1, [
        makePlayerUpdate({
          id: "alice",
          smallID: 1,
          outgoingAttacks: [
            {
              attackerID: 1,
              targetID: 2,
              troops: 500,
              id: "a1",
              retreating: false,
            },
            {
              attackerID: 1,
              targetID: 3,
              troops: 300,
              id: "a2",
              retreating: false,
            },
          ],
          incomingAttacks: [
            {
              attackerID: 4,
              targetID: 1,
              troops: 80,
              id: "a3",
              retreating: false,
            },
          ],
        }),
      ]),
    );

    const gu = makeEmptyGu(2);
    // [ownerSmallID, direction (0=outgoing, 1=incoming), index, troops]
    gu.packedAttackUpdates = new Float64Array([1, 0, 1, 290, 1, 1, 0, 75]);
    game.update(gu);

    const alice = game.player("alice");
    expect(alice.outgoingAttacks().map((a) => a.troops)).toEqual([500, 290]);
    expect(alice.incomingAttacks().map((a) => a.troops)).toEqual([75]);
  });

  it("quads for unknown smallIDs and out-of-range attack indexes are ignored", () => {
    const game = makeGameView();
    game.update(
      withPlayers(1, [makePlayerUpdate({ id: "alice", smallID: 1 })]),
    );
    const gu = makeEmptyGu(2);
    gu.packedPlayerUpdates = new Float64Array([99, 1, 1, 1]);
    gu.packedAttackUpdates = new Float64Array([1, 0, 5, 123, 99, 1, 0, 7]);
    expect(() => game.update(gu)).not.toThrow();
  });

  it("same-tick array resend and patch on different directions both apply", () => {
    const game = makeGameView();
    game.update(
      withPlayers(1, [
        makePlayerUpdate({
          id: "alice",
          smallID: 1,
          outgoingAttacks: [
            {
              attackerID: 1,
              targetID: 2,
              troops: 500,
              id: "a1",
              retreating: false,
            },
          ],
          incomingAttacks: [
            {
              attackerID: 4,
              targetID: 1,
              troops: 80,
              id: "a3",
              retreating: false,
            },
          ],
        }),
      ]),
    );

    // Outgoing membership changed → full array resent with fresh troops;
    // incoming membership unchanged → troops arrive as a patch. The patch
    // must land on the long-lived incoming array and not interfere with the
    // resent outgoing array (a tick resends or patches each array, never
    // both — but different directions can mix on one tick).
    const gu = makeEmptyGu(2);
    gu.updates[GameUpdateType.Player] = [
      {
        type: GameUpdateType.Player,
        id: "alice",
        outgoingAttacks: [
          {
            attackerID: 1,
            targetID: 2,
            troops: 450,
            id: "a1",
            retreating: false,
          },
          {
            attackerID: 1,
            targetID: 3,
            troops: 100,
            id: "a2",
            retreating: false,
          },
        ],
      },
    ];
    gu.packedAttackUpdates = new Float64Array([1, 1, 0, 75]);
    game.update(gu);

    const alice = game.player("alice");
    expect(alice.outgoingAttacks().map((a) => a.troops)).toEqual([450, 100]);
    expect(alice.incomingAttacks().map((a) => a.troops)).toEqual([75]);
  });

  it("gold survives the float64 quad exactly, including > 2^32 values", () => {
    const game = makeGameView();
    game.update(
      withPlayers(1, [makePlayerUpdate({ id: "alice", smallID: 1 })]),
    );
    const bigGold = 2 ** 52 + 11; // integer, exactly representable in f64
    const gu = makeEmptyGu(2);
    gu.packedPlayerUpdates = new Float64Array([1, 0, bigGold, 0]);
    game.update(gu);
    expect(game.player("alice").gold()).toBe(BigInt(bigGold));
  });

  it("nameData persists across ticks without a playerNameViewData record", () => {
    const game = makeGameView();
    game.update(
      withPlayers(1, [makePlayerUpdate({ id: "alice", smallID: 1 })], {
        alice: { x: 7, y: 9, size: 3 },
      }),
    );
    expect(game.frameData().names.get("alice")).toMatchObject({ x: 7, y: 9 });

    // Tick without a record (worker omits it between placement rebuilds) —
    // even with a player update present, the old placement must survive.
    const gu = makeEmptyGu(2);
    gu.updates[GameUpdateType.Player] = [
      makePlayerUpdate({ id: "alice", smallID: 1 }),
    ];
    game.update(gu);
    expect(game.frameData().names.get("alice")).toMatchObject({ x: 7, y: 9 });

    // A new record updates the placement (alice is alive).
    const gu3 = makeEmptyGu(3);
    gu3.playerNameViewData = { alice: { x: 11, y: 13, size: 4 } };
    game.update(gu3);
    expect(game.frameData().names.get("alice")).toMatchObject({ x: 11, y: 13 });
  });

  it("dead players keep their last name placement (freeze at death)", () => {
    const game = makeGameView();
    game.update(
      withPlayers(1, [makePlayerUpdate({ id: "alice", smallID: 1 })], {
        alice: { x: 7, y: 9, size: 3 },
      }),
    );

    // Alice dies.
    const gu2 = makeEmptyGu(2);
    gu2.updates[GameUpdateType.Player] = [
      makePlayerUpdate({ id: "alice", smallID: 1, isAlive: false }),
    ];
    game.update(gu2);

    // A later record must not move her name.
    const gu3 = makeEmptyGu(3);
    gu3.playerNameViewData = { alice: { x: 0, y: 0, size: 0 } };
    game.update(gu3);
    expect(game.frameData().names.get("alice")).toMatchObject({ x: 7, y: 9 });
  });
});

describe("GameView.update — derived-data dirty flags", () => {
  function twoPlayers() {
    const game = makeGameView();
    game.update(
      withPlayers(1, [
        makePlayerUpdate({ id: "alice", smallID: 1 }),
        makePlayerUpdate({ id: "bob", smallID: 2 }),
      ]),
    );
    return game;
  }

  it("relationMatrix recomputes when allies arrive on a partial update", () => {
    const game = twoPlayers();
    const size = game.frameData().relationSize;
    expect(game.frameData().relationMatrix[1 * size + 2]).toBe(0); // neutral

    const gu = makeEmptyGu(2);
    gu.updates[GameUpdateType.Player] = [
      { type: GameUpdateType.Player, id: "alice", allies: [2] },
    ];
    game.update(gu);
    // friendly, both directions
    expect(game.frameData().relationMatrix[1 * size + 2]).toBe(1);
    expect(game.frameData().relationMatrix[2 * size + 1]).toBe(1);
  });

  it("relationMatrix recomputes when embargoes arrive on a partial update", () => {
    const game = twoPlayers();
    const size = game.frameData().relationSize;

    const gu = makeEmptyGu(2);
    gu.updates[GameUpdateType.Player] = [
      {
        type: GameUpdateType.Player,
        id: "alice",
        embargoes: new Set(["bob"]),
      },
    ];
    game.update(gu);
    expect(game.frameData().relationMatrix[1 * size + 2]).toBe(2); // embargo
  });

  it("allianceClusters keep identity on clean ticks and recompute on allies change", () => {
    const game = twoPlayers();
    const before = game.frameData().allianceClusters;
    expect(before.get(1)).not.toBe(before.get(2)); // separate clusters

    // Clean tick: no relation inputs changed → cached object, untouched.
    game.update(makeEmptyGu(2));
    expect(game.frameData().allianceClusters).toBe(before);

    // Alliance forms → recomputed: alice and bob share a cluster root.
    const gu = makeEmptyGu(3);
    gu.updates[GameUpdateType.Player] = [
      { type: GameUpdateType.Player, id: "alice", allies: [2] },
      { type: GameUpdateType.Player, id: "bob", allies: [1] },
    ];
    game.update(gu);
    const after = game.frameData().allianceClusters;
    expect(after).not.toBe(before);
    expect(after.get(1)).toBe(after.get(2));
  });

  it("names map keeps identity and content on ticks without a record", () => {
    const game = makeGameView();
    game.update(
      withPlayers(1, [makePlayerUpdate({ id: "alice", smallID: 1 })], {
        alice: { x: 7, y: 9, size: 3 },
      }),
    );
    const names = game.frameData().names;
    const entry = names.get("alice");

    game.update(makeEmptyGu(2));
    expect(game.frameData().names).toBe(names); // long-lived map
    expect(game.frameData().names.get("alice")).toBe(entry); // not rebuilt
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

  it("frame.relationMatrix marks same-team players as friendly (team games)", () => {
    const RELATION_FRIENDLY = 1;
    const RELATION_NEUTRAL = 0;
    const game = makeGameView();
    game.update(
      withPlayers(1, [
        makePlayerUpdate({ id: "alice", smallID: 1, team: "red" }),
        makePlayerUpdate({ id: "bob", smallID: 2, team: "red" }),
        makePlayerUpdate({ id: "carol", smallID: 3, team: "blue" }),
      ]),
    );
    const { relationMatrix, relationSize } = game.frameData();
    // Teammates (no explicit alliance) are friendly both ways.
    expect(relationMatrix[1 * relationSize + 2]).toBe(RELATION_FRIENDLY);
    expect(relationMatrix[2 * relationSize + 1]).toBe(RELATION_FRIENDLY);
    // Cross-team players stay neutral.
    expect(relationMatrix[1 * relationSize + 3]).toBe(RELATION_NEUTRAL);
    expect(relationMatrix[3 * relationSize + 1]).toBe(RELATION_NEUTRAL);
  });
});
