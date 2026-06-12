/**
 * extractNukeTelegraphs colors each telegraph by who launched the nuke:
 *
 *   - relation 0 (self): the local player owns the nuke
 *   - relation 1 (friendly): an ally or teammate owns it (via relation matrix)
 *   - relation 2 (enemy): everyone else, and everything in replay / spectator
 *     mode (no local player)
 */

import { describe, expect, it } from "vitest";
import {
  extractNukeTelegraphs,
  TELEGRAPH_ENEMY,
  TELEGRAPH_FRIENDLY,
  TELEGRAPH_SELF,
} from "../../../../../src/client/render/frame/derive/NukeTelegraphs";
import { buildRelationMatrix } from "../../../../../src/client/render/frame/derive/RelationMatrix";
import type {
  PlayerState,
  UnitState,
} from "../../../../../src/client/render/types";
import {
  UT_ATOM_BOMB,
  UT_WARSHIP,
} from "../../../../../src/client/render/types";

const MAP_W = 100;

function ps(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    smallID: 1,
    isAlive: true,
    isDisconnected: false,
    tilesOwned: 0,
    gold: 0,
    troops: 0,
    isTraitor: false,
    traitorRemainingTicks: 0,
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

function nuke(overrides: Partial<UnitState> = {}): UnitState {
  return {
    id: 1,
    unitType: UT_ATOM_BOMB,
    ownerID: 1,
    lastOwnerID: null,
    pos: 0,
    lastPos: 0,
    isActive: true,
    reachedTarget: false,
    retreating: false,
    targetable: true,
    markedForDeletion: false,
    health: null,
    underConstruction: false,
    targetUnitId: null,
    targetTile: 305,
    troops: 0,
    missileTimerQueue: [],
    level: 1,
    hasTrainStation: false,
    trainType: null,
    loaded: null,
    constructionStartTick: null,
    ...overrides,
  };
}

function units(...us: UnitState[]): Map<number, UnitState> {
  return new Map(us.map((u) => [u.id, u]));
}

describe("extractNukeTelegraphs", () => {
  it("computes target x/y and blast radii", () => {
    const [t] = extractNukeTelegraphs(units(nuke({ targetTile: 305 })), MAP_W);
    expect(t).toMatchObject({ x: 5, y: 3, innerRadius: 12, outerRadius: 30 });
  });

  it("skips inactive nukes, nukes without a target, and non-nuke units", () => {
    const result = extractNukeTelegraphs(
      units(
        nuke({ id: 1, isActive: false }),
        nuke({ id: 2, targetTile: null }),
        nuke({ id: 3, unitType: UT_WARSHIP }),
      ),
      MAP_W,
    );
    expect(result).toHaveLength(0);
  });

  it("marks the local player's own nukes as self", () => {
    const rel = buildRelationMatrix(new Map([[1, ps({ smallID: 1 })]]));
    const [t] = extractNukeTelegraphs(
      units(nuke({ ownerID: 1 })),
      MAP_W,
      1,
      rel.matrix,
      rel.size,
    );
    expect(t.relation).toBe(TELEGRAPH_SELF);
  });

  it("marks an ally's nuke as friendly", () => {
    const rel = buildRelationMatrix(
      new Map([
        [1, ps({ smallID: 1, allies: [2] })],
        [2, ps({ smallID: 2 })],
      ]),
    );
    const [t] = extractNukeTelegraphs(
      units(nuke({ ownerID: 2 })),
      MAP_W,
      1,
      rel.matrix,
      rel.size,
    );
    expect(t.relation).toBe(TELEGRAPH_FRIENDLY);
  });

  it("marks a teammate's nuke as friendly", () => {
    const rel = buildRelationMatrix(
      new Map([
        [1, ps({ smallID: 1 })],
        [2, ps({ smallID: 2 })],
      ]),
      new Map([
        [1, "red"],
        [2, "red"],
      ]),
    );
    const [t] = extractNukeTelegraphs(
      units(nuke({ ownerID: 2 })),
      MAP_W,
      1,
      rel.matrix,
      rel.size,
    );
    expect(t.relation).toBe(TELEGRAPH_FRIENDLY);
  });

  it("marks everyone else's nukes as enemy", () => {
    const rel = buildRelationMatrix(
      new Map([
        [1, ps({ smallID: 1 })],
        [2, ps({ smallID: 2 })],
      ]),
    );
    const [t] = extractNukeTelegraphs(
      units(nuke({ ownerID: 2 })),
      MAP_W,
      1,
      rel.matrix,
      rel.size,
    );
    expect(t.relation).toBe(TELEGRAPH_ENEMY);
  });

  it("marks everything as enemy without a local player (replay/spectator)", () => {
    const [t] = extractNukeTelegraphs(units(nuke({ ownerID: 1 })), MAP_W);
    expect(t.relation).toBe(TELEGRAPH_ENEMY);
  });
});
