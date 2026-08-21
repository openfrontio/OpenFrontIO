/**
 * computePlayerStatus has two modes:
 *
 *   - Replay mode (no localPlayerSmallID): only crown / traitor / disconnected /
 *     nukeActive flags are populated. All relative flags are false.
 *   - Live mode (localPlayerSmallID set): also fills alliance / target / embargo,
 *     and nukeTargetsMe if a tileState buffer is supplied.
 *
 * The function only emits an entry per player when at least one flag is true
 * (the NamePass treats missing entries as "all flags off"). Tests assert
 * both presence and absence of entries.
 */

import { describe, expect, it } from "vitest";
import { computePlayerStatus } from "../../../../../src/client/render/frame/derive/PlayerStatus";
import type {
  PlayerState,
  UnitState,
} from "../../../../../src/client/render/types";
import {
  UT_ATOM_BOMB,
  UT_WARSHIP,
} from "../../../../../src/client/render/types";

function ps(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    smallID: 1,
    isAlive: true,
    isDisconnected: false,
    killedBy: null,
    deathPosition: null,
    tilesOwned: 0,
    gold: 0,
    troops: 0,
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

function unit(overrides: Partial<UnitState> = {}): UnitState {
  return {
    id: 1,
    unitType: UT_WARSHIP,
    ownerID: 1,
    lastOwnerID: null,
    pos: 0,
    lastPos: 0,
    isActive: true,
    reachedTarget: false,
    retreating: false,
    targetable: true,
    waitTicks: 0,
    markedForDeletion: false,
    health: null,
    underConstruction: false,
    targetUnitId: null,
    targetTile: null,
    troops: 0,
    missileTimerQueue: [],
    level: 1,
    veterancy: 0,
    hasTrainStation: false,
    trainType: null,
    loaded: null,
    constructionStartTick: null,
    samUpgradeStartTick: null,
    samUpgradeStartRange: null,
    samUpgradeTargetLevel: null,
    samUpgradeDuration: null,
    ...overrides,
  };
}

function playersMap(...players: PlayerState[]): Map<number, PlayerState> {
  return new Map(players.map((p) => [p.smallID, p]));
}

function unitsMap(...us: UnitState[]): Map<number, UnitState> {
  return new Map(us.map((u) => [u.id, u]));
}

describe("computePlayerStatus — replay mode (no localPlayerSmallID)", () => {
  it("returns empty map when no flags are set", () => {
    const players = playersMap(ps({ smallID: 1 }));
    const status = computePlayerStatus(players, unitsMap());
    expect(status.size).toBe(0);
  });

  it("crown goes to the alive player with most tiles owned", () => {
    const players = playersMap(
      ps({ smallID: 1, tilesOwned: 100 }),
      ps({ smallID: 2, tilesOwned: 500 }), // king
      ps({ smallID: 3, tilesOwned: 250 }),
    );
    const status = computePlayerStatus(players, unitsMap());
    expect(status.get(2)?.crown).toBe(true);
    // Players 1 and 3 don't have crown and no other flags → no entry emitted.
    expect(status.has(1)).toBe(false);
    expect(status.has(3)).toBe(false);
  });

  it("dead players don't get the crown even if they had the most tiles", () => {
    const players = playersMap(
      ps({ smallID: 1, tilesOwned: 1000, isAlive: false }),
      ps({ smallID: 2, tilesOwned: 100 }),
    );
    const status = computePlayerStatus(players, unitsMap());
    expect(status.get(2)?.crown).toBe(true);
    expect(status.has(1)).toBe(false);
  });

  it("traitor + traitorRemainingTicks flow through", () => {
    const players = playersMap(
      ps({ smallID: 1, isTraitor: true, traitorRemainingTicks: 42 }),
    );
    const status = computePlayerStatus(players, unitsMap());
    expect(status.get(1)?.traitor).toBe(true);
    expect(status.get(1)?.traitorRemainingTicks).toBe(42);
  });

  it("disconnected flag flows through", () => {
    const players = playersMap(ps({ smallID: 1, isDisconnected: true }));
    const status = computePlayerStatus(players, unitsMap());
    expect(status.get(1)?.disconnected).toBe(true);
  });

  it("nukeActive: any in-flight nuke marks its owner", () => {
    const players = playersMap(ps({ smallID: 1 }), ps({ smallID: 2 }));
    const units = unitsMap(
      unit({ id: 10, ownerID: 2, unitType: UT_ATOM_BOMB, isActive: true }),
    );
    const status = computePlayerStatus(players, units);
    expect(status.get(2)?.nukeActive).toBe(true);
    expect(status.has(1)).toBe(false);
  });

  it("inactive nukes don't trigger nukeActive", () => {
    const players = playersMap(ps({ smallID: 1 }));
    const units = unitsMap(
      unit({ id: 10, ownerID: 1, unitType: UT_ATOM_BOMB, isActive: false }),
    );
    const status = computePlayerStatus(players, units);
    expect(status.has(1)).toBe(false);
  });

  it("relative flags (alliance/target/embargo/nukeTargetsMe) are always false in replay mode", () => {
    const players = playersMap(
      ps({ smallID: 1, allies: [2], targets: [2], embargoes: [2] }),
      ps({ smallID: 2, tilesOwned: 1 }), // crown so an entry exists
    );
    const status = computePlayerStatus(players, unitsMap());
    expect(status.get(2)?.alliance).toBe(false);
    expect(status.get(2)?.target).toBe(false);
    expect(status.get(2)?.embargo).toBe(false);
    expect(status.get(2)?.nukeTargetsMe).toBe(false);
  });
});

describe("computePlayerStatus — live mode (localPlayerSmallID set)", () => {
  it("alliance: local has them as ally → alliance true", () => {
    const players = playersMap(
      ps({ smallID: 1, allies: [2] }), // me
      ps({ smallID: 2 }),
    );
    const status = computePlayerStatus(players, unitsMap(), {
      localPlayerSmallID: 1,
    });
    expect(status.get(2)?.alliance).toBe(true);
  });

  it("target: local has them in targets → target true", () => {
    const players = playersMap(
      ps({ smallID: 1, targets: [2] }), // me
      ps({ smallID: 2 }),
    );
    const status = computePlayerStatus(players, unitsMap(), {
      localPlayerSmallID: 1,
    });
    expect(status.get(2)?.target).toBe(true);
  });

  it("embargo is bilateral: true if I embargo them OR they embargo me", () => {
    // I embargo them.
    let status = computePlayerStatus(
      playersMap(ps({ smallID: 1, embargoes: [2] }), ps({ smallID: 2 })),
      unitsMap(),
      { localPlayerSmallID: 1 },
    );
    expect(status.get(2)?.embargo).toBe(true);

    // They embargo me.
    status = computePlayerStatus(
      playersMap(ps({ smallID: 1 }), ps({ smallID: 2, embargoes: [1] })),
      unitsMap(),
      { localPlayerSmallID: 1 },
    );
    expect(status.get(2)?.embargo).toBe(true);

    // Neither.
    status = computePlayerStatus(
      playersMap(ps({ smallID: 1 }), ps({ smallID: 2, tilesOwned: 1 })),
      unitsMap(),
      { localPlayerSmallID: 1 },
    );
    // Player 2 only has crown — embargo should be false.
    expect(status.get(2)?.embargo).toBe(false);
  });

  it("relative flags are NOT set for the local player itself (no self-relationships)", () => {
    const players = playersMap(
      ps({
        smallID: 1,
        tilesOwned: 100,
        allies: [1],
        targets: [1],
        embargoes: [1],
      }),
      ps({ smallID: 2 }),
    );
    const status = computePlayerStatus(players, unitsMap(), {
      localPlayerSmallID: 1,
    });
    // Player 1 (local) gets crown but no relative flags vs. self.
    expect(status.get(1)?.crown).toBe(true);
    expect(status.get(1)?.alliance).toBe(false);
    expect(status.get(1)?.target).toBe(false);
    expect(status.get(1)?.embargo).toBe(false);
  });

  it("nukeTargetsMe: requires tileState — without it, stays false", () => {
    const players = playersMap(ps({ smallID: 1 }), ps({ smallID: 2 }));
    const units = unitsMap(
      unit({
        id: 10,
        ownerID: 2,
        unitType: UT_ATOM_BOMB,
        isActive: true,
        targetTile: 5,
      }),
    );
    const status = computePlayerStatus(players, units, {
      localPlayerSmallID: 1,
    });
    expect(status.get(2)?.nukeActive).toBe(true);
    expect(status.get(2)?.nukeTargetsMe).toBe(false);
  });

  it("nukeTargetsMe: true when nuke targets a tile owned by local player", () => {
    const players = playersMap(ps({ smallID: 1 }), ps({ smallID: 2 }));
    const units = unitsMap(
      unit({
        id: 10,
        ownerID: 2,
        unitType: UT_ATOM_BOMB,
        isActive: true,
        targetTile: 5,
      }),
    );
    // tileState[5] low 12 bits = 1 (local player's smallID).
    const tileState = new Uint16Array(16);
    tileState[5] = 1;

    const status = computePlayerStatus(players, units, {
      localPlayerSmallID: 1,
      tileState,
    });
    expect(status.get(2)?.nukeTargetsMe).toBe(true);
  });

  it("nukeTargetsMe: false when nuke targets a tile owned by someone else", () => {
    const players = playersMap(
      ps({ smallID: 1 }),
      ps({ smallID: 2 }),
      ps({ smallID: 3 }),
    );
    const units = unitsMap(
      unit({
        id: 10,
        ownerID: 2,
        unitType: UT_ATOM_BOMB,
        isActive: true,
        targetTile: 5,
      }),
    );
    // tileState[5] = player 3, not me.
    const tileState = new Uint16Array(16);
    tileState[5] = 3;

    const status = computePlayerStatus(players, units, {
      localPlayerSmallID: 1,
      tileState,
    });
    expect(status.get(2)?.nukeTargetsMe).toBe(false);
  });

  it("entry is emitted when only a relative flag is true (even with no base flags)", () => {
    const players = playersMap(
      ps({ smallID: 1, allies: [2] }), // me
      ps({ smallID: 2 }), // no other flags
    );
    const status = computePlayerStatus(players, unitsMap(), {
      localPlayerSmallID: 1,
    });
    // Without local-mode, player 2 wouldn't get an entry — alliance is the
    // only reason it shows up here.
    expect(status.get(2)).toBeDefined();
    expect(status.get(2)?.alliance).toBe(true);
  });

  it("localPlayerSmallID = 0 (no local player) behaves like replay mode", () => {
    const players = playersMap(
      ps({ smallID: 1, allies: [2] }),
      ps({ smallID: 2, tilesOwned: 1 }),
    );
    const status = computePlayerStatus(players, unitsMap(), {
      localPlayerSmallID: 0,
    });
    expect(status.get(2)?.alliance).toBe(false);
  });

  it("allianceReq and allianceFraction are not computed (deferred)", () => {
    const players = playersMap(
      ps({ smallID: 1, allies: [2] }),
      ps({ smallID: 2 }),
    );
    const status = computePlayerStatus(players, unitsMap(), {
      localPlayerSmallID: 1,
    });
    expect(status.get(2)?.allianceReq).toBe(false);
    expect(status.get(2)?.allianceFraction).toBe(0);
  });

  it("allianceFraction and allianceRemainingTicks come from the alliance expiry", () => {
    const players = playersMap(
      ps({ smallID: 1, allies: [2] }),
      ps({
        smallID: 2,
        alliances: [
          {
            id: 1,
            other: "me",
            createdAt: 100,
            expiresAt: 700,
            hasExtensionRequest: false,
          },
        ],
      }),
    );
    const status = computePlayerStatus(players, unitsMap(), {
      localPlayerSmallID: 1,
      localPlayerID: "me",
      tick: 400,
      allianceDuration: 600,
    });
    expect(status.get(2)?.allianceFraction).toBe(0.5);
    expect(status.get(2)?.allianceRemainingTicks).toBe(300);
  });
});

describe("computePlayerStatus — doomsday clock phases", () => {
  // Three phases drive three different skulls: blinking (warn), steady white
  // (draining), steady RED (decaying). The last one comes straight from the sim.
  const WARN = 300; // 30s

  function phase(over: Partial<PlayerState>) {
    const out = computePlayerStatus(
      new Map([[1, ps({ smallID: 1, ...over })]]),
      new Map(),
      {
        tick: 1000,
        doomsdayClockWarnTicks: WARN,
      },
    );
    return out.get(1)!;
  }

  it("is neither draining nor decaying while merely warning", () => {
    const s = phase({
      inDoomsdayClock: true,
      markedDoomsdayClockTick: 1000 - 100,
    });
    expect(s.doomsdayClockDraining).toBe(false);
    expect(s.doomsdayClockDecaying).toBe(false);
  });

  it("drains but does not decay once past the warn", () => {
    const s = phase({
      inDoomsdayClock: true,
      markedDoomsdayClockTick: 1000 - 400,
    });
    expect(s.doomsdayClockDraining).toBe(true);
    expect(s.doomsdayClockDecaying).toBe(false);
  });

  it("decays when the sim says territory is rotting", () => {
    const s = phase({
      inDoomsdayClock: true,
      markedDoomsdayClockTick: 1000 - 400,
      isDecaying: true,
    });
    expect(s.doomsdayClockDraining).toBe(true);
    expect(s.doomsdayClockDecaying).toBe(true);
  });

  it("never decays a side that is not flagged at all", () => {
    // Defensive: a stale isDecaying must not paint a skull on a recovered side.
    // An unflagged player may get no status entry at all, which is equally fine —
    // what matters is that nothing reports a decaying skull.
    const out = computePlayerStatus(
      new Map([
        [1, ps({ smallID: 1, inDoomsdayClock: false, isDecaying: true })],
      ]),
      new Map(),
      { tick: 1000, doomsdayClockWarnTicks: WARN },
    );
    expect(out.get(1)?.doomsdayClockDecaying ?? false).toBe(false);
  });
});
