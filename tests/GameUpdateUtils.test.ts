import { describe, expect, it } from "vitest";
import type { PlayerState } from "../src/client/render/types";
import { PlayerType } from "../src/core/game/Game";
import {
  applyStateUpdate,
  diffPlayerUpdate,
  packAttackTroopDeltas,
} from "../src/core/game/GameUpdateUtils";
import {
  AttackUpdate,
  GameUpdateType,
  PlayerUpdate,
} from "../src/core/game/GameUpdates";
import { makePlayerUpdate } from "./util/viewStubs";

function makePlayerState(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    smallID: 1,
    isAlive: true,
    isDisconnected: false,
    killedBy: null,
    deathPosition: null,
    tilesOwned: 0,
    gold: 0,
    troops: 100,
    isTraitor: false,
    traitorRemainingTicks: 0,
    inDoomsdayClock: false,
    isDecaying: false,
    markedDoomsdayClockTick: -1,
    betrayals: 0,
    hasSpawned: true,
    lastDeleteUnitTick: 0,
    allies: [],
    embargoes: [],
    targets: [],
    outgoingAttacks: [],
    incomingAttacks: [],
    outgoingAllianceRequests: [],
    alliances: [],
    outgoingEmojis: [],
    ...overrides,
  };
}

describe("diffPlayerUpdate", () => {
  it("returns null when prev and next are identical", () => {
    const prev = makePlayerUpdate();
    const next = makePlayerUpdate();
    expect(diffPlayerUpdate(prev, next)).toBeNull();
  });

  it("returns a diff with only changed primitives plus type+id", () => {
    const prev = makePlayerUpdate({ betrayals: 0 });
    const next = makePlayerUpdate({ betrayals: 1 });
    const diff = diffPlayerUpdate(prev, next);
    expect(diff).not.toBeNull();
    expect(diff).toEqual({
      type: GameUpdateType.Player,
      id: "player-a",
      betrayals: 1,
    });
  });

  it("includes every changed primitive in a single diff", () => {
    const prev = makePlayerUpdate({ betrayals: 0, isTraitor: false });
    const next = makePlayerUpdate({ betrayals: 1, isTraitor: true });
    const diff = diffPlayerUpdate(prev, next)!;
    expect(diff.betrayals).toBe(1);
    expect(diff.isTraitor).toBe(true);
    expect(diff.hasSpawned).toBeUndefined();
  });

  it("carries a changed clanTag and stays quiet when it is unchanged", () => {
    expect(
      diffPlayerUpdate(
        makePlayerUpdate({ clanTag: "ABCDE" }),
        makePlayerUpdate({ clanTag: "ABCDE" }),
      ),
    ).toBeNull();
    const diff = diffPlayerUpdate(
      makePlayerUpdate({ clanTag: null }),
      makePlayerUpdate({ clanTag: "ABCDE" }),
    )!;
    expect(diff.clanTag).toBe("ABCDE");
  });

  it("carries a changed nationFlag and stays quiet when it is unchanged", () => {
    expect(
      diffPlayerUpdate(
        makePlayerUpdate({ nationFlag: "in" }),
        makePlayerUpdate({ nationFlag: "in" }),
      ),
    ).toBeNull();
    const diff = diffPlayerUpdate(
      makePlayerUpdate({ nationFlag: null }),
      makePlayerUpdate({ nationFlag: "pk" }),
    )!;
    expect(diff.nationFlag).toBe("pk");
  });

  it("emits killedBy + deathPosition when a player is eliminated", () => {
    const prev = makePlayerUpdate({ killedBy: null, deathPosition: null });
    const next = makePlayerUpdate({ killedBy: "client-b", deathPosition: 3 });
    const diff = diffPlayerUpdate(prev, next)!;
    expect(diff.killedBy).toBe("client-b");
    expect(diff.deathPosition).toBe(3);
  });

  it("ignores tilesOwned/gold/troops — they travel via packedPlayerUpdates", () => {
    const prev = makePlayerUpdate({ gold: 100n, troops: 50, tilesOwned: 5 });
    const next = makePlayerUpdate({ gold: 200n, troops: 75, tilesOwned: 9 });
    expect(diffPlayerUpdate(prev, next)).toBeNull();
  });

  it("detects allies array additions", () => {
    const prev = makePlayerUpdate({ allies: [2, 3] });
    const next = makePlayerUpdate({ allies: [2, 3, 4] });
    const diff = diffPlayerUpdate(prev, next)!;
    expect(diff.allies).toEqual([2, 3, 4]);
  });

  it("ignores allies array when contents are equal (different identity)", () => {
    const prev = makePlayerUpdate({ allies: [2, 3] });
    const next = makePlayerUpdate({ allies: [2, 3] });
    expect(diffPlayerUpdate(prev, next)).toBeNull();
  });

  it("treats allies reorder as a change (order is significant)", () => {
    const prev = makePlayerUpdate({ allies: [2, 3] });
    const next = makePlayerUpdate({ allies: [3, 2] });
    const diff = diffPlayerUpdate(prev, next)!;
    expect(diff.allies).toEqual([3, 2]);
  });

  it("detects embargo set membership changes", () => {
    const prev = makePlayerUpdate({ embargoes: new Set(["x", "y"]) });
    const next = makePlayerUpdate({ embargoes: new Set(["x", "y", "z"]) });
    const diff = diffPlayerUpdate(prev, next)!;
    expect(diff.embargoes).toEqual(new Set(["x", "y", "z"]));
  });

  it("ignores embargo set when membership is equal regardless of object identity", () => {
    const prev = makePlayerUpdate({ embargoes: new Set(["x", "y"]) });
    const next = makePlayerUpdate({ embargoes: new Set(["y", "x"]) });
    expect(diffPlayerUpdate(prev, next)).toBeNull();
  });

  it("detects outgoingAttacks membership/retreating changes", () => {
    const prev = makePlayerUpdate({
      outgoingAttacks: [
        { attackerID: 1, targetID: 2, troops: 10, id: "a", retreating: false },
      ],
    });
    const next = makePlayerUpdate({
      outgoingAttacks: [
        { attackerID: 1, targetID: 2, troops: 10, id: "a", retreating: true },
      ],
    });
    const diff = diffPlayerUpdate(prev, next)!;
    expect(diff.outgoingAttacks).toEqual(next.outgoingAttacks);
  });

  it("ignores attack troop-count changes — they travel via packedAttackUpdates", () => {
    const prev = makePlayerUpdate({
      outgoingAttacks: [
        { attackerID: 1, targetID: 2, troops: 10, id: "a", retreating: false },
      ],
    });
    const next = makePlayerUpdate({
      outgoingAttacks: [
        { attackerID: 1, targetID: 2, troops: 20, id: "a", retreating: false },
      ],
    });
    expect(diffPlayerUpdate(prev, next)).toBeNull();
  });

  it("detects alliance list changes", () => {
    const prev = makePlayerUpdate({ alliances: [] });
    const next = makePlayerUpdate({
      alliances: [
        {
          id: 1,
          other: "player-b",
          createdAt: 10,
          expiresAt: 110,
          hasExtensionRequest: false,
        },
      ],
    });
    const diff = diffPlayerUpdate(prev, next)!;
    expect(diff.alliances).toEqual(next.alliances);
  });

  it("treats undefined→number transition as a change", () => {
    const prev = makePlayerUpdate({ traitorRemainingTicks: undefined });
    const next = makePlayerUpdate({ traitorRemainingTicks: 5 });
    const diff = diffPlayerUpdate(prev, next)!;
    expect(diff.traitorRemainingTicks).toBe(5);
  });

  it("treats number→undefined transition as a change", () => {
    const prev = makePlayerUpdate({ traitorRemainingTicks: 5 });
    const next = makePlayerUpdate({ traitorRemainingTicks: undefined });
    const diff = diffPlayerUpdate(prev, next);
    expect(diff).not.toBeNull();
    expect("traitorRemainingTicks" in diff!).toBe(true);
    expect(diff!.traitorRemainingTicks).toBeUndefined();
  });

  it("always includes type and id on a non-null diff", () => {
    const prev = makePlayerUpdate({ betrayals: 0 });
    const next = makePlayerUpdate({ betrayals: 1 });
    const diff = diffPlayerUpdate(prev, next)!;
    expect(diff.type).toBe(GameUpdateType.Player);
    expect(diff.id).toBe(next.id);
  });
});

describe("packAttackTroopDeltas", () => {
  const attack = (
    troops: number,
    id = "a",
    retreating = false,
  ): AttackUpdate => ({
    attackerID: 1,
    targetID: 2,
    troops,
    id,
    retreating,
  });

  it("emits [owner, direction, index, troops] quads for changed troop counts", () => {
    const out: number[] = [];
    packAttackTroopDeltas(
      [attack(10, "a"), attack(20, "b")],
      [attack(10, "a"), attack(15, "b")],
      7,
      1,
      out,
    );
    expect(out).toEqual([7, 1, 1, 15]);
  });

  it("emits nothing when arrays are not membership-equal (diff resends them)", () => {
    const out: number[] = [];
    packAttackTroopDeltas(
      [attack(10, "a")],
      [attack(15, "a"), attack(5, "b")],
      7,
      0,
      out,
    );
    expect(out).toEqual([]);
  });

  it("a retreat flip suppresses quads even when troops also changed", () => {
    // retreating is part of membership equality, so the whole array resends
    // (with fresh troops) and patches must NOT be emitted — a tick resends
    // or patches, never both.
    const out: number[] = [];
    packAttackTroopDeltas(
      [attack(10, "a", false)],
      [attack(5, "a", true)],
      7,
      0,
      out,
    );
    expect(out).toEqual([]);
  });

  it("emits nothing for identical references or missing arrays", () => {
    const out: number[] = [];
    const arr = [attack(10)];
    packAttackTroopDeltas(arr, arr, 7, 0, out);
    packAttackTroopDeltas(undefined, arr, 7, 0, out);
    packAttackTroopDeltas(arr, undefined, 7, 0, out);
    expect(out).toEqual([]);
  });
});

describe("applyStateUpdate", () => {
  it("applies killedBy + deathPosition on elimination", () => {
    const target = makePlayerState();
    applyStateUpdate(
      target,
      makePlayerUpdate({ killedBy: "client-b", deathPosition: 3 }),
    );
    expect(target.killedBy).toBe("client-b");
    expect(target.deathPosition).toBe(3);
  });

  it("applies every field from a full update", () => {
    const target = makePlayerState();
    const pu = makePlayerUpdate({
      gold: 500n,
      troops: 999,
      tilesOwned: 42,
      allies: [7, 8],
      targets: [9],
      outgoingAllianceRequests: ["player-b"],
      isAlive: false,
      isTraitor: true,
      traitorRemainingTicks: 3,
      betrayals: 2,
      hasSpawned: true,
      lastDeleteUnitTick: 50,
    });
    applyStateUpdate(target, pu);
    expect(target.gold).toBe(500);
    expect(target.troops).toBe(999);
    expect(target.tilesOwned).toBe(42);
    expect(target.allies).toEqual([7, 8]);
    expect(target.targets).toEqual([9]);
    expect(target.outgoingAllianceRequests).toEqual(["player-b"]);
    expect(target.isAlive).toBe(false);
    expect(target.isTraitor).toBe(true);
    expect(target.traitorRemainingTicks).toBe(3);
    expect(target.betrayals).toBe(2);
    expect(target.lastDeleteUnitTick).toBe(50);
  });

  it("converts bigint gold to number", () => {
    const target = makePlayerState({ gold: 0 });
    applyStateUpdate(target, {
      type: GameUpdateType.Player,
      id: "p",
      gold: 9_999_999_999n,
    });
    expect(target.gold).toBe(9_999_999_999);
    expect(typeof target.gold).toBe("number");
  });

  it("clamps negative traitorRemainingTicks to zero", () => {
    const target = makePlayerState({ traitorRemainingTicks: 5 });
    applyStateUpdate(target, {
      type: GameUpdateType.Player,
      id: "p",
      traitorRemainingTicks: -10,
    });
    expect(target.traitorRemainingTicks).toBe(0);
  });

  it("only mutates fields present on the partial update", () => {
    const target = makePlayerState({ gold: 100, troops: 50, tilesOwned: 7 });
    const partial: PlayerUpdate = {
      type: GameUpdateType.Player,
      id: "p",
      gold: 200n,
    };
    applyStateUpdate(target, partial);
    expect(target.gold).toBe(200);
    expect(target.troops).toBe(50);
    expect(target.tilesOwned).toBe(7);
  });

  it("leaves array fields untouched when omitted", () => {
    const original = [1, 2, 3];
    const target = makePlayerState({ allies: original });
    applyStateUpdate(target, { type: GameUpdateType.Player, id: "p" });
    expect(target.allies).toBe(original);
  });

  it("detaches array fields by slicing (no shared reference with wire payload)", () => {
    const wireAllies = [1, 2, 3];
    const wireTargets = [9];
    const wireRequests = ["player-b"];
    const target = makePlayerState();
    applyStateUpdate(target, {
      type: GameUpdateType.Player,
      id: "p",
      allies: wireAllies,
      targets: wireTargets,
      outgoingAllianceRequests: wireRequests,
    });
    expect(target.allies).toEqual(wireAllies);
    expect(target.allies).not.toBe(wireAllies);
    expect(target.targets).not.toBe(wireTargets);
    expect(target.outgoingAllianceRequests).not.toBe(wireRequests);
  });

  it("does not touch smallID even when present (identity field)", () => {
    const target = makePlayerState({ smallID: 42 });
    applyStateUpdate(target, {
      type: GameUpdateType.Player,
      id: "p",
      smallID: 999,
    });
    expect(target.smallID).toBe(42);
  });

  it("merges several partial updates into a cumulative state", () => {
    const target = makePlayerState();
    applyStateUpdate(target, {
      type: GameUpdateType.Player,
      id: "p",
      gold: 100n,
    });
    applyStateUpdate(target, {
      type: GameUpdateType.Player,
      id: "p",
      troops: 250,
    });
    applyStateUpdate(target, {
      type: GameUpdateType.Player,
      id: "p",
      isAlive: false,
    });
    expect(target.gold).toBe(100);
    expect(target.troops).toBe(250);
    expect(target.isAlive).toBe(false);
  });
});

describe("diff + apply round-trip", () => {
  it("emitting full first + diff second reconstructs final state", () => {
    // tilesOwned/gold/troops round-trip via packedPlayerUpdates instead
    // (covered in tests/client/view/GameView.test.ts).
    const v0 = makePlayerUpdate({ betrayals: 0, allies: [] });
    const v1 = makePlayerUpdate({ betrayals: 2, allies: [2] });

    // Initial state: receiver applies the full update.
    const target = makePlayerState();
    applyStateUpdate(target, v0);

    // Subsequent tick: emitter sends only the diff.
    const diff = diffPlayerUpdate(v0, v1)!;
    expect(diff).not.toBeNull();
    applyStateUpdate(target, diff);

    expect(target.betrayals).toBe(2);
    expect(target.allies).toEqual([2]);
  });

  it("no-change tick produces null diff so receiver state is untouched", () => {
    const v0 = makePlayerUpdate({ gold: 100n, playerType: PlayerType.Human });
    const v1 = makePlayerUpdate({ gold: 100n, playerType: PlayerType.Human });
    expect(diffPlayerUpdate(v0, v1)).toBeNull();
  });
});

describe("diffPlayerUpdate — every scalar field must be wired up", () => {
  // diffPlayerUpdate sends ONLY changed fields, so a field added to PlayerUpdate
  // without a matching setIfDifferent() line is silently never transmitted: the
  // client keeps its initial value forever. That is not a hypothetical -- it is
  // exactly how `isDecaying` shipped broken (the red doomsday skull never lit,
  // because the flag flipped in the sim and no update ever carried it).
  //
  // This walks every scalar field on a PlayerUpdate, flips it, and asserts the
  // diff carries it and applyStateUpdate merges it. Non-scalars (arrays, nested
  // objects) have bespoke comparators and are covered by the tests above.
  const SKIP = new Set([
    // Identity: never changes for a given player.
    "type",
    "id",
    "smallID",
    "clientID",
    // Deliberately NOT diffed: these ride the packed transferable channel
    // (GameUpdateViewData.packedPlayerUpdates) every tick instead. See the
    // diffPlayerUpdate doc comment.
    "tilesOwned",
    "gold",
    "troops",
  ]);

  function flip(value: unknown): unknown {
    if (typeof value === "boolean") return !value;
    if (typeof value === "number") return value + 7;
    if (typeof value === "bigint") return value + 7n;
    if (typeof value === "string") return value + "-changed";
    return undefined; // not a scalar
  }

  const base = makePlayerUpdate({ id: "p1" });
  const asRecord = base as unknown as Record<string, unknown>;
  const scalars = Object.keys(base).filter(
    (k) =>
      !SKIP.has(k) && asRecord[k] !== null && flip(asRecord[k]) !== undefined,
  );

  it("covers a meaningful number of fields (guards the walk itself)", () => {
    expect(scalars.length).toBeGreaterThan(8);
  });

  for (const key of scalars) {
    it(`transmits a change to ${key}`, () => {
      const next = { ...base, [key]: flip(asRecord[key]) } as PlayerUpdate;
      const diff = diffPlayerUpdate(base, next);
      expect(diff, `${key} produced no diff at all`).not.toBeNull();
      expect(
        Object.prototype.hasOwnProperty.call(diff, key),
        `${key} is missing a setIfDifferent() line in diffPlayerUpdate`,
      ).toBe(true);
    });
  }

  it("merges isDecaying through to the client state", () => {
    const state = makePlayerState({ isDecaying: false });
    applyStateUpdate(state, { ...base, isDecaying: true } as PlayerUpdate);
    expect(state.isDecaying).toBe(true);
    // ...and a later update that omits it must not clobber it.
    applyStateUpdate(state, {
      type: GameUpdateType.Player,
      id: "p1",
    } as PlayerUpdate);
    expect(state.isDecaying).toBe(true);
  });
});
