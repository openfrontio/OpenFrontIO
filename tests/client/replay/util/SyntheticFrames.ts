/** Hand-built GameUpdateViewData for tests that don't need a simulation. */

import {
  PlayerType,
  UnitType,
  type GameUpdates,
} from "../../../../src/core/game/Game";
import {
  GameUpdateType,
  type GameUpdateViewData,
  type PlayerUpdate,
  type UnitUpdate,
} from "../../../../src/core/game/GameUpdates";

export function emptyUpdates(): GameUpdates {
  const updates = {} as Record<number, unknown[]>;
  for (const v of Object.values(GameUpdateType)) {
    if (typeof v === "number") updates[v] = [];
  }
  return updates as unknown as GameUpdates;
}

export function frame(
  tick: number,
  parts: Partial<Omit<GameUpdateViewData, "tick" | "updates">> & {
    updates?: Partial<Record<GameUpdateType, unknown[]>>;
  } = {},
): GameUpdateViewData {
  const updates = emptyUpdates() as unknown as Record<number, unknown[]>;
  for (const [k, v] of Object.entries(parts.updates ?? {})) {
    updates[Number(k)] = v as unknown[];
  }
  return {
    packedTileUpdates: new Uint32Array(0),
    ...parts,
    tick,
    updates: updates as unknown as GameUpdates,
  };
}

/** A player's first (full) emission. */
export function fullPlayer(
  smallID: number,
  overrides: Partial<PlayerUpdate> = {},
): PlayerUpdate {
  return {
    type: GameUpdateType.Player,
    id: `p${smallID}`,
    clientID: `client${smallID}`,
    name: `Player ${smallID}`,
    displayName: `Player ${smallID}`,
    clanTag: null,
    nationFlag: null,
    team: undefined,
    smallID,
    playerType: PlayerType.Human,
    isAlive: true,
    isDisconnected: false,
    killedBy: null,
    deathPosition: null,
    tilesOwned: 10,
    gold: 100n,
    tradeGold: 0n,
    trainGold: 0n,
    piracyGold: 0n,
    goldEarned: 100n,
    troops: 1000,
    allies: [],
    embargoes: new Set(),
    isTraitor: false,
    traitorRemainingTicks: 0,
    inDoomsdayClock: false,
    isDecaying: false,
    markedDoomsdayClockTick: -1,
    targets: [],
    outgoingEmojis: [],
    outgoingAttacks: [],
    incomingAttacks: [],
    outgoingAllianceRequests: [],
    alliances: [],
    hasSpawned: true,
    spawnTile: 5,
    betrayals: 0,
    lastDeleteUnitTick: -1,
    isLobbyCreator: false,
    ...overrides,
  };
}

/** A partial (diff) emission carrying only `fields`. */
export function partialPlayer(
  smallID: number,
  fields: Partial<PlayerUpdate>,
): PlayerUpdate {
  return { type: GameUpdateType.Player, id: `p${smallID}`, ...fields };
}

export function unit(
  id: number,
  overrides: Partial<UnitUpdate> = {},
): UnitUpdate {
  return {
    type: GameUpdateType.Unit,
    unitType: UnitType.City,
    troops: 0,
    id,
    ownerID: 1,
    pos: 10,
    lastPos: 10,
    isActive: true,
    reachedTarget: false,
    targetable: true,
    markedForDeletion: false,
    missileTimerQueue: [],
    level: 1,
    hasTrainStation: false,
    ...overrides,
  };
}
