/**
 * Conversions from engine updates (PlayerUpdate / UnitUpdate) to the
 * renderer's PlayerState / PlayerStatic / UnitState records.
 *
 * No DOM, settings or GameView imports here, so the replay encoder
 * (src/client/replay/codec) can use them in a worker and get the same records as
 * the live client.
 */
import { PlayerID, PlayerType, TrainType } from "../../core/game/Game";
import { PlayerUpdate, UnitUpdate } from "../../core/game/GameUpdates";
import { ATTACK_DELTA_OUTGOING } from "../../core/game/GameUpdateUtils";
import {
  PlayerState,
  PlayerStatic,
  PlayerTypeEnum,
  TrainType as RendererTrainType,
  UnitState,
} from "../render/types";

/**
 * Convert engine TrainType (string enum) to renderer's numeric encoding.
 * UnitState uses 0/1/2 so it can be uploaded to GPU buffers without lookup.
 */
export function trainTypeToNum(t: TrainType | undefined): number | null {
  switch (t) {
    case TrainType.Engine:
      return RendererTrainType.Engine;
    case TrainType.TailEngine:
      return RendererTrainType.TailEngine;
    case TrainType.Carriage:
      return RendererTrainType.Carriage;
    default:
      return null;
  }
}

/** Build a fresh UnitState from an incoming UnitUpdate. */
export function unitStateFromUpdate(u: UnitUpdate): UnitState {
  return {
    id: u.id,
    unitType: u.unitType,
    ownerID: u.ownerID,
    lastOwnerID: u.lastOwnerID ?? null,
    pos: u.pos,
    lastPos: u.lastPos,
    isActive: u.isActive,
    reachedTarget: u.reachedTarget,
    retreating:
      (u.transportShipState?.isRetreating ?? false) ||
      u.warshipState?.state === "retreating",
    targetable: u.targetable,
    waitTicks: u.nukeState?.waitTicks ?? 0,
    markedForDeletion: u.markedForDeletion,
    health: u.health ?? null,
    underConstruction: u.underConstruction ?? false,
    targetUnitId: u.targetUnitId ?? null,
    targetTile: u.targetTile ?? null,
    troops: u.troops,
    missileTimerQueue: u.missileTimerQueue,
    level: u.level,
    veterancy: u.warshipState?.veterancy ?? 0,
    hasTrainStation: u.hasTrainStation,
    trainType: trainTypeToNum(u.trainType),
    loaded: u.loaded ?? null,
    constructionStartTick: null, // GameView fills in createdAt when underConstruction
    samUpgradeStartTick: u.samUpgrade?.upgradeStartTick ?? null,
    samUpgradeStartRange: u.samUpgrade?.startRange ?? null,
    samUpgradeTargetLevel: u.samUpgrade?.targetLevel ?? null,
    samUpgradeDuration: u.samUpgrade?.duration ?? null,
  };
}

/** Mutate `target` in place from a UnitUpdate, avoiding any allocation. */
export function applyUnitUpdateInPlace(target: UnitState, u: UnitUpdate): void {
  target.ownerID = u.ownerID;
  target.unitType = u.unitType;
  target.lastOwnerID = u.lastOwnerID ?? null;
  target.pos = u.pos;
  target.lastPos = u.lastPos;
  target.isActive = u.isActive;
  target.reachedTarget = u.reachedTarget;
  target.retreating =
    (u.transportShipState?.isRetreating ?? false) ||
    u.warshipState?.state === "retreating";
  target.targetable = u.targetable;
  target.waitTicks = u.nukeState?.waitTicks ?? 0;
  target.markedForDeletion = u.markedForDeletion;
  target.health = u.health ?? null;
  target.underConstruction = u.underConstruction ?? false;
  target.targetUnitId = u.targetUnitId ?? null;
  target.targetTile = u.targetTile ?? null;
  target.troops = u.troops;
  target.missileTimerQueue = u.missileTimerQueue;
  target.level = u.level;
  target.veterancy = u.warshipState?.veterancy ?? 0;
  target.hasTrainStation = u.hasTrainStation;
  target.trainType = trainTypeToNum(u.trainType);
  target.loaded = u.loaded ?? null;
  target.samUpgradeStartTick = u.samUpgrade?.upgradeStartTick ?? null;
  target.samUpgradeStartRange = u.samUpgrade?.startRange ?? null;
  target.samUpgradeTargetLevel = u.samUpgrade?.targetLevel ?? null;
  target.samUpgradeDuration = u.samUpgrade?.duration ?? null;
}

export function gamePlayerTypeToEnum(t: PlayerType): PlayerTypeEnum {
  switch (t) {
    case PlayerType.Human:
      return PlayerTypeEnum.Human;
    case PlayerType.Bot:
      return PlayerTypeEnum.Bot;
    case PlayerType.Nation:
      return PlayerTypeEnum.Nation;
    default:
      return PlayerTypeEnum.Bot;
  }
}

/** The engine's PlayerType for a renderer PlayerTypeEnum. */
export function playerTypeFromEnum(t: PlayerTypeEnum): PlayerType {
  switch (t) {
    case PlayerTypeEnum.Human:
      return PlayerType.Human;
    case PlayerTypeEnum.Nation:
      return PlayerType.Nation;
    default:
      return PlayerType.Bot;
  }
}

// First-emission updates from the engine always include every field; these
// builders assert non-null for that contract. Subsequent diffs are partial
// and flow through applyStateUpdate() (GameUpdateUtils).
export function playerStaticFromUpdate(pu: PlayerUpdate): PlayerStatic {
  return {
    smallID: pu.smallID!,
    id: pu.id,
    name: pu.name!,
    displayName: pu.displayName!,
    clanTag: pu.clanTag ?? null,
    clientID: pu.clientID ?? null,
    playerType: gamePlayerTypeToEnum(pu.playerType!),
    team: pu.team ?? null,
    isLobbyCreator: pu.isLobbyCreator!,
  };
}

export function playerStateFromUpdate(pu: PlayerUpdate): PlayerState {
  // embargoes: Set<PlayerID strings> on the wire, but the renderer stores
  // smallIDs (numbers). Callers fill these in once they have the
  // PlayerID → smallID lookup table (GameView.setEmbargoes()).
  return {
    smallID: pu.smallID!,
    isAlive: pu.isAlive!,
    isDisconnected: pu.isDisconnected!,
    killedBy: pu.killedBy ?? null,
    deathPosition: pu.deathPosition ?? null,
    tilesOwned: pu.tilesOwned!,
    gold: Number(pu.gold!),
    tradeGold: Number(pu.tradeGold ?? 0n),
    trainGold: Number(pu.trainGold ?? 0n),
    piracyGold: Number(pu.piracyGold ?? 0n),
    goldEarned: Number(pu.goldEarned ?? 0n),
    troops: pu.troops!,
    isTraitor: pu.isTraitor!,
    traitorRemainingTicks: Math.max(0, pu.traitorRemainingTicks ?? 0),
    inDoomsdayClock: pu.inDoomsdayClock ?? false,
    isDecaying: pu.isDecaying ?? false,
    markedDoomsdayClockTick: pu.markedDoomsdayClockTick ?? -1,
    betrayals: pu.betrayals!,
    hasSpawned: pu.hasSpawned!,
    spawnTile: pu.spawnTile,
    lastDeleteUnitTick: pu.lastDeleteUnitTick!,
    allies: pu.allies!.slice(),
    embargoes: [],
    targets: pu.targets!.slice(),
    outgoingAttacks: pu.outgoingAttacks!,
    incomingAttacks: pu.incomingAttacks!,
    outgoingAllianceRequests: pu.outgoingAllianceRequests!.slice(),
    alliances: pu.alliances!,
    outgoingEmojis: pu.outgoingEmojis!,
  };
}

/**
 * A player's embargoes as smallIDs (the renderer's form). The engine sends
 * PlayerIDs; ones that don't resolve yet are left out.
 */
export function embargoSmallIDs(
  embargoes: Iterable<PlayerID>,
  smallIDOf: (id: PlayerID) => number | undefined,
): number[] {
  const out: number[] = [];
  for (const id of embargoes) {
    const smallID = smallIDOf(id);
    if (smallID !== undefined) out.push(smallID);
  }
  return out;
}

/**
 * Apply GameUpdateViewData.packedPlayerUpdates: [smallID, tilesOwned, gold,
 * troops, goldEarned] for every player whose stats changed this tick.
 * `applied` is called with each player that got new stats.
 */
export function applyPackedPlayerStats(
  packed: Float64Array | undefined,
  stateOf: (smallID: number) => PlayerState | undefined,
  applied?: (smallID: number) => void,
): void {
  if (packed === undefined) return;
  for (let i = 0; i + 4 < packed.length; i += 5) {
    const state = stateOf(packed[i]);
    if (state === undefined) continue;
    state.tilesOwned = packed[i + 1];
    state.gold = packed[i + 2];
    state.troops = packed[i + 3];
    state.goldEarned = packed[i + 4];
    applied?.(packed[i]);
  }
}

/**
 * Apply GameUpdateViewData.packedAttackUpdates: [ownerSmallID, direction,
 * index, troops] for attacks whose troop count changed. The attack arrays
 * are only resent when membership or order changes, which keeps these
 * indexes valid: a tick either resends an array or patches it, never both
 * (see packAttackTroopDeltas). With `copy`, a patched attack is replaced by
 * a copy rather than changed, for callers that keep earlier states around.
 * `applied` is called with the owner of every quad.
 */
export function applyPackedAttackTroops(
  packed: Float64Array | undefined,
  stateOf: (smallID: number) => PlayerState | undefined,
  opts: { copy?: boolean; applied?: (smallID: number) => void } = {},
): void {
  if (packed === undefined) return;
  for (let i = 0; i + 3 < packed.length; i += 4) {
    const state = stateOf(packed[i]);
    if (state === undefined) continue;
    const attacks =
      packed[i + 1] === ATTACK_DELTA_OUTGOING
        ? state.outgoingAttacks
        : state.incomingAttacks;
    const index = packed[i + 2];
    const attack = attacks[index];
    if (attack !== undefined) {
      if (opts.copy) attacks[index] = { ...attack, troops: packed[i + 3] };
      else attack.troops = packed[i + 3];
    }
    opts.applied?.(packed[i]);
  }
}
