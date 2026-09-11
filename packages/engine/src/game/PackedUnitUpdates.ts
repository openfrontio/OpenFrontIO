import { TrainType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType, UnitUpdate } from "@openfront/engine-api/game/GameUpdates";

export const UNIT_UPDATE_STRIDE = 20;

export const OFFSET_ID = 0;
export const OFFSET_POS = 1;
export const OFFSET_LAST_POS = 2;
export const OFFSET_TROOPS = 3;
export const OFFSET_HEALTH = 4;
export const OFFSET_TARGET_TILE = 5;
export const OFFSET_TARGET_UNIT_ID = 6;
export const OFFSET_MARKED_FOR_DELETION = 7;
export const OFFSET_WARSHIP_LAST_COMBAT_TICK = 8;
export const OFFSET_WARSHIP_PATROL_TILE = 9;
export const OFFSET_WARSHIP_RETREAT_PORT = 10;
export const OFFSET_WARSHIP_VETERANCY_PROGRESS = 11;
export const OFFSET_SAM_UPGRADE_START_TICK = 12;
export const OFFSET_SAM_UPGRADE_DURATION = 13;
export const OFFSET_SAM_UPGRADE_START_RANGE = 14;
export const OFFSET_SAM_UPGRADE_TARGET_LEVEL = 15;
export const OFFSET_TRANSPORT_TROOPS = 16;
export const OFFSET_NUKE_WAIT_TICKS = 17;
export const OFFSET_PACKED_A = 18;
export const OFFSET_PACKED_B = 19;

// unitType mapping
export const unitTypeToInt = (type: UnitType): number => {
  switch (type) {
    case UnitType.TransportShip: return 1;
    case UnitType.Warship: return 2;
    case UnitType.Shell: return 3;
    case UnitType.SAMMissile: return 4;
    case UnitType.Port: return 5;
    case UnitType.AtomBomb: return 6;
    case UnitType.HydrogenBomb: return 7;
    case UnitType.TradeShip: return 8;
    case UnitType.MissileSilo: return 9;
    case UnitType.DefensePost: return 10;
    case UnitType.SAMLauncher: return 11;
    case UnitType.City: return 12;
    case UnitType.MIRV: return 13;
    case UnitType.MIRVWarhead: return 14;
    case UnitType.Train: return 15;
    case UnitType.Factory: return 16;
    default: return 0;
  }
};

export const intToUnitType = (val: number): UnitType => {
  switch (val) {
    case 1: return UnitType.TransportShip;
    case 2: return UnitType.Warship;
    case 3: return UnitType.Shell;
    case 4: return UnitType.SAMMissile;
    case 5: return UnitType.Port;
    case 6: return UnitType.AtomBomb;
    case 7: return UnitType.HydrogenBomb;
    case 8: return UnitType.TradeShip;
    case 9: return UnitType.MissileSilo;
    case 10: return UnitType.DefensePost;
    case 11: return UnitType.SAMLauncher;
    case 12: return UnitType.City;
    case 13: return UnitType.MIRV;
    case 14: return UnitType.MIRVWarhead;
    case 15: return UnitType.Train;
    case 16: return UnitType.Factory;
    default: return UnitType.City; // fallback
  }
};

export const trainTypeToInt = (type: TrainType | undefined): number => {
  if (!type) return 0;
  switch (type) {
    case TrainType.Engine: return 1;
    case TrainType.TailEngine: return 2;
    case TrainType.Carriage: return 3;
    default: return 0;
  }
};

export const intToTrainType = (val: number): TrainType | undefined => {
  switch (val) {
    case 1: return TrainType.Engine;
    case 2: return TrainType.TailEngine;
    case 3: return TrainType.Carriage;
    default: return undefined;
  }
};

// Packed A: ownerID (12 bits), lastOwnerID (12 bits), unitType (5 bits)
export const packA = (ownerID: number, lastOwnerID: number | undefined, unitType: UnitType): number => {
  const oID = ownerID & 0xFFF;
  const lID = lastOwnerID !== undefined ? (lastOwnerID & 0xFFF) : 0xFFF;
  const uType = unitTypeToInt(unitType) & 0x1F;
  return (oID) | (lID << 12) | (uType << 24);
};

export const unpackAOwnerID = (packed: number): number => packed & 0xFFF;
export const unpackALastOwnerID = (packed: number): number | undefined => {
  const val = (packed >> 12) & 0xFFF;
  return val === 0xFFF ? undefined : val;
};
export const unpackAUnitType = (packed: number): UnitType => intToUnitType((packed >> 24) & 0x1F);

// Packed B: level (8 bits), warshipState (2 bits), flags (many bits)
export const packB = (update: UnitUpdate): number => {
  let val = 0;
  val |= (update.level & 0xFF);
  
  if (update.isActive) val |= (1 << 8);
  if (update.reachedTarget) val |= (1 << 9);
  if (update.targetable) val |= (1 << 10);
  if (update.underConstruction) val |= (1 << 11);
  if (update.hasTrainStation) val |= (1 << 12);
  
  if (update.loaded !== undefined) {
    val |= (update.loaded ? 2 : 1) << 13;
  }
  
  val |= (trainTypeToInt(update.trainType) & 0x3) << 15;
  
  if (update.warshipState) {
    val |= (1 << 17);
    const s = update.warshipState.state === "patrolling" ? 0 : update.warshipState.state === "retreating" ? 1 : 2;
    val |= (s & 0x3) << 18;
    if (update.warshipState.isInCombat) val |= (1 << 20);
    val |= (update.warshipState.veterancy & 0x3F) << 21; // 6 bits for veterancy
  }
  
  if (update.transportShipState) {
    val |= (1 << 27);
    if (update.transportShipState.isRetreating) val |= (1 << 28);
  }
  
  if (update.nukeState) {
    val |= (1 << 29);
    if (update.nukeState.targetedBySam) val |= (1 << 30);
  }
  
  if (update.samUpgrade) {
    val |= (1 << 31); // Wait, bit 31 makes it negative when signed, that's fine for bitwise ops, we use >>> 0 in unpack to ensure unsigned if needed. Actually << 31 works.
  }
  
  return val;
};

// Readers for Packed B
export const unpackBLevel = (packed: number): number => packed & 0xFF;
export const unpackBIsActive = (packed: number): boolean => (packed & (1 << 8)) !== 0;
export const unpackBReachedTarget = (packed: number): boolean => (packed & (1 << 9)) !== 0;
export const unpackBTargetable = (packed: number): boolean => (packed & (1 << 10)) !== 0;
export const unpackBUnderConstruction = (packed: number): boolean => (packed & (1 << 11)) !== 0;
export const unpackBHasTrainStation = (packed: number): boolean => (packed & (1 << 12)) !== 0;
export const unpackBLoaded = (packed: number): boolean | undefined => {
  const v = (packed >> 13) & 0x3;
  if (v === 0) return undefined;
  return v === 2;
};
export const unpackBTrainType = (packed: number): TrainType | undefined => intToTrainType((packed >> 15) & 0x3);

export const unpackBHasWarshipState = (packed: number): boolean => (packed & (1 << 17)) !== 0;
export const unpackBWarshipStateState = (packed: number): "patrolling" | "retreating" | "docked" => {
  const v = (packed >> 18) & 0x3;
  return v === 0 ? "patrolling" : v === 1 ? "retreating" : "docked";
};
export const unpackBWarshipIsInCombat = (packed: number): boolean => (packed & (1 << 20)) !== 0;
export const unpackBWarshipVeterancy = (packed: number): number => (packed >> 21) & 0x3F;

export const unpackBHasTransportShipState = (packed: number): boolean => (packed & (1 << 27)) !== 0;
export const unpackBTransportIsRetreating = (packed: number): boolean => (packed & (1 << 28)) !== 0;

export const unpackBHasNukeState = (packed: number): boolean => (packed & (1 << 29)) !== 0;
export const unpackBNukeTargetedBySam = (packed: number): boolean => (packed & (1 << 30)) !== 0;

// Need to use unsigned right shift for bit 31 if interpreting as unsigned, or just check negative
export const unpackBHasSamUpgrade = (packed: number): boolean => (packed & (1 << 31)) !== 0;

export class PackedUnitUpdateDecoder {
  constructor(private buffer: Float64Array, private offset: number) {}
  
  get id(): number { return this.buffer[this.offset + OFFSET_ID]; }
  get pos(): number { return this.buffer[this.offset + OFFSET_POS]; }
  get lastPos(): number { return this.buffer[this.offset + OFFSET_LAST_POS]; }
  get troops(): number { return this.buffer[this.offset + OFFSET_TROOPS]; }
  get health(): number | undefined { 
    const v = this.buffer[this.offset + OFFSET_HEALTH];
    return Number.isNaN(v) ? undefined : v; 
  }
  get targetTile(): number | undefined {
    const v = this.buffer[this.offset + OFFSET_TARGET_TILE];
    return Number.isNaN(v) ? undefined : v; 
  }
  get targetUnitId(): number | undefined {
    const v = this.buffer[this.offset + OFFSET_TARGET_UNIT_ID];
    return Number.isNaN(v) ? undefined : v; 
  }
  get markedForDeletion(): number | false {
    const v = this.buffer[this.offset + OFFSET_MARKED_FOR_DELETION];
    return Number.isNaN(v) ? false : v;
  }
  
  get ownerID(): number { return unpackAOwnerID(this.buffer[this.offset + OFFSET_PACKED_A]); }
  get lastOwnerID(): number | undefined { return unpackALastOwnerID(this.buffer[this.offset + OFFSET_PACKED_A]); }
  get unitType(): UnitType { return unpackAUnitType(this.buffer[this.offset + OFFSET_PACKED_A]); }
  
  get level(): number { return unpackBLevel(this.buffer[this.offset + OFFSET_PACKED_B]); }
  get isActive(): boolean { return unpackBIsActive(this.buffer[this.offset + OFFSET_PACKED_B]); }
  get reachedTarget(): boolean { return unpackBReachedTarget(this.buffer[this.offset + OFFSET_PACKED_B]); }
  get targetable(): boolean { return unpackBTargetable(this.buffer[this.offset + OFFSET_PACKED_B]); }
  get underConstruction(): boolean { return unpackBUnderConstruction(this.buffer[this.offset + OFFSET_PACKED_B]); }
  get hasTrainStation(): boolean { return unpackBHasTrainStation(this.buffer[this.offset + OFFSET_PACKED_B]); }
  get loaded(): boolean | undefined { return unpackBLoaded(this.buffer[this.offset + OFFSET_PACKED_B]); }
  get trainType(): TrainType | undefined { return unpackBTrainType(this.buffer[this.offset + OFFSET_PACKED_B]); }
  
  // States
  get hasWarshipState(): boolean { return unpackBHasWarshipState(this.buffer[this.offset + OFFSET_PACKED_B]); }
  get warshipStateState(): "patrolling" | "retreating" | "docked" { return unpackBWarshipStateState(this.buffer[this.offset + OFFSET_PACKED_B]); }
  get warshipIsInCombat(): boolean { return unpackBWarshipIsInCombat(this.buffer[this.offset + OFFSET_PACKED_B]); }
  get warshipVeterancy(): number { return unpackBWarshipVeterancy(this.buffer[this.offset + OFFSET_PACKED_B]); }
  get warshipVeterancyProgress(): number { return this.buffer[this.offset + OFFSET_WARSHIP_VETERANCY_PROGRESS]; }
  get warshipLastCombatTick(): number { return this.buffer[this.offset + OFFSET_WARSHIP_LAST_COMBAT_TICK]; }
  get warshipPatrolTile(): number | undefined {
    const v = this.buffer[this.offset + OFFSET_WARSHIP_PATROL_TILE];
    return Number.isNaN(v) ? undefined : v; 
  }
  get warshipRetreatPort(): number | undefined {
    const v = this.buffer[this.offset + OFFSET_WARSHIP_RETREAT_PORT];
    return Number.isNaN(v) ? undefined : v; 
  }
  
  get hasTransportShipState(): boolean { return unpackBHasTransportShipState(this.buffer[this.offset + OFFSET_PACKED_B]); }
  get transportIsRetreating(): boolean { return unpackBTransportIsRetreating(this.buffer[this.offset + OFFSET_PACKED_B]); }
  get transportTroops(): number { return this.buffer[this.offset + OFFSET_TRANSPORT_TROOPS]; }
  
  get hasNukeState(): boolean { return unpackBHasNukeState(this.buffer[this.offset + OFFSET_PACKED_B]); }
  get nukeTargetedBySam(): boolean { return unpackBNukeTargetedBySam(this.buffer[this.offset + OFFSET_PACKED_B]); }
  get nukeWaitTicks(): number { return this.buffer[this.offset + OFFSET_NUKE_WAIT_TICKS]; }
  
  get hasSamUpgrade(): boolean { return unpackBHasSamUpgrade(this.buffer[this.offset + OFFSET_PACKED_B]); }
  get samUpgradeStartTick(): number | undefined {
    const v = this.buffer[this.offset + OFFSET_SAM_UPGRADE_START_TICK];
    return Number.isNaN(v) ? undefined : v;
  }
  get samUpgradeDuration(): number { return this.buffer[this.offset + OFFSET_SAM_UPGRADE_DURATION]; }
  get samUpgradeStartRange(): number { return this.buffer[this.offset + OFFSET_SAM_UPGRADE_START_RANGE]; }
  get samUpgradeTargetLevel(): number { return this.buffer[this.offset + OFFSET_SAM_UPGRADE_TARGET_LEVEL]; }

  toUnitUpdate(): UnitUpdate {
    let warshipState;
    if (this.hasWarshipState) {
      warshipState = {
        state: this.warshipStateState,
        patrolTile: this.warshipPatrolTile,
        retreatPort: this.warshipRetreatPort,
        isInCombat: this.warshipIsInCombat,
        lastCombatTick: this.warshipLastCombatTick,
        veterancy: this.warshipVeterancy,
        veterancyProgress: this.warshipVeterancyProgress,
      };
    }
    
    let transportShipState;
    if (this.hasTransportShipState) {
      transportShipState = {
        isRetreating: this.transportIsRetreating,
        troops: this.transportTroops,
      };
    }
    
    let nukeState;
    if (this.hasNukeState) {
      nukeState = {
        targetedBySam: this.nukeTargetedBySam,
        waitTicks: this.nukeWaitTicks,
      };
    }
    
    let samUpgrade;
    if (this.hasSamUpgrade) {
      samUpgrade = {
        upgradeStartTick: this.samUpgradeStartTick,
        startRange: this.samUpgradeStartRange,
        targetLevel: this.samUpgradeTargetLevel,
        duration: this.samUpgradeDuration,
      };
    }

    return {
      type: GameUpdateType.Unit,
      unitType: this.unitType,
      troops: this.troops,
      id: this.id,
      ownerID: this.ownerID,
      lastOwnerID: this.lastOwnerID,
      pos: this.pos,
      lastPos: this.lastPos,
      isActive: this.isActive,
      reachedTarget: this.reachedTarget,
      warshipState,
      transportShipState,
      nukeState,
      targetable: this.targetable,
      markedForDeletion: this.markedForDeletion,
      targetUnitId: this.targetUnitId,
      targetTile: this.targetTile,
      health: this.health,
      underConstruction: this.underConstruction,
      level: this.level,
      hasTrainStation: this.hasTrainStation,
      trainType: this.trainType,
      loaded: this.loaded,
      samUpgrade,
      missileTimerQueue: [],
    };
  }
}

export function packUnitUpdates(units: UnitUpdate[]): { packedUnitUpdates: Float64Array; packedMissileTimers: Uint32Array } {
  const packedUnitUpdates = new Float64Array(units.length * UNIT_UPDATE_STRIDE);
  
  let totalMissileTimers = 0;
  for (let i = 0; i < units.length; i++) {
    if (units[i].missileTimerQueue && units[i].missileTimerQueue.length > 0) {
      totalMissileTimers += 2 + units[i].missileTimerQueue.length; // unitId + length + timers
    }
  }
  
  const packedMissileTimers = new Uint32Array(totalMissileTimers);
  let timerOffset = 0;
  
  for (let i = 0; i < units.length; i++) {
    const update = units[i];
    const offset = i * UNIT_UPDATE_STRIDE;
    
    packedUnitUpdates[offset + OFFSET_ID] = update.id;
    packedUnitUpdates[offset + OFFSET_POS] = update.pos;
    packedUnitUpdates[offset + OFFSET_LAST_POS] = update.lastPos;
    packedUnitUpdates[offset + OFFSET_TROOPS] = update.troops;
    packedUnitUpdates[offset + OFFSET_HEALTH] = update.health !== undefined ? update.health : NaN;
    packedUnitUpdates[offset + OFFSET_TARGET_TILE] = update.targetTile !== undefined ? update.targetTile : NaN;
    packedUnitUpdates[offset + OFFSET_TARGET_UNIT_ID] = update.targetUnitId !== undefined ? update.targetUnitId : NaN;
    packedUnitUpdates[offset + OFFSET_MARKED_FOR_DELETION] = update.markedForDeletion !== false ? update.markedForDeletion : NaN;
    
    if (update.warshipState) {
      packedUnitUpdates[offset + OFFSET_WARSHIP_LAST_COMBAT_TICK] = update.warshipState.lastCombatTick;
      packedUnitUpdates[offset + OFFSET_WARSHIP_PATROL_TILE] = update.warshipState.patrolTile !== undefined ? update.warshipState.patrolTile : NaN;
      packedUnitUpdates[offset + OFFSET_WARSHIP_RETREAT_PORT] = update.warshipState.retreatPort !== undefined ? update.warshipState.retreatPort : NaN;
      packedUnitUpdates[offset + OFFSET_WARSHIP_VETERANCY_PROGRESS] = update.warshipState.veterancyProgress;
    } else {
      packedUnitUpdates[offset + OFFSET_WARSHIP_LAST_COMBAT_TICK] = 0;
      packedUnitUpdates[offset + OFFSET_WARSHIP_PATROL_TILE] = NaN;
      packedUnitUpdates[offset + OFFSET_WARSHIP_RETREAT_PORT] = NaN;
      packedUnitUpdates[offset + OFFSET_WARSHIP_VETERANCY_PROGRESS] = 0;
    }
    
    if (update.samUpgrade) {
      packedUnitUpdates[offset + OFFSET_SAM_UPGRADE_START_TICK] = update.samUpgrade.upgradeStartTick ?? NaN;
      packedUnitUpdates[offset + OFFSET_SAM_UPGRADE_DURATION] = update.samUpgrade.duration ?? NaN;
      packedUnitUpdates[offset + OFFSET_SAM_UPGRADE_START_RANGE] = update.samUpgrade.startRange ?? NaN;
      packedUnitUpdates[offset + OFFSET_SAM_UPGRADE_TARGET_LEVEL] = update.samUpgrade.targetLevel ?? NaN;
    } else {
      packedUnitUpdates[offset + OFFSET_SAM_UPGRADE_START_TICK] = 0;
      packedUnitUpdates[offset + OFFSET_SAM_UPGRADE_DURATION] = 0;
      packedUnitUpdates[offset + OFFSET_SAM_UPGRADE_START_RANGE] = 0;
      packedUnitUpdates[offset + OFFSET_SAM_UPGRADE_TARGET_LEVEL] = 0;
    }
    
    packedUnitUpdates[offset + OFFSET_TRANSPORT_TROOPS] = update.transportShipState ? update.transportShipState.troops : 0;
    packedUnitUpdates[offset + OFFSET_NUKE_WAIT_TICKS] = update.nukeState ? update.nukeState.waitTicks : 0;
    
    packedUnitUpdates[offset + OFFSET_PACKED_A] = packA(update.ownerID, update.lastOwnerID, update.unitType);
    packedUnitUpdates[offset + OFFSET_PACKED_B] = packB(update);
    
    if (update.missileTimerQueue && update.missileTimerQueue.length > 0) {
      packedMissileTimers[timerOffset++] = update.id;
      packedMissileTimers[timerOffset++] = update.missileTimerQueue.length;
      for (let j = 0; j < update.missileTimerQueue.length; j++) {
        packedMissileTimers[timerOffset++] = update.missileTimerQueue[j];
      }
    }
  }
  
  return { packedUnitUpdates, packedMissileTimers };
}
