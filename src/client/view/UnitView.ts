import {
  Tick,
  TrainType,
  TransportShipState,
  UnitType,
  WarshipState,
} from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";
import { UnitUpdate } from "../../core/game/GameUpdates";
import type { UnitState } from "../render/types";
import { TrainType as RendererTrainType } from "../render/types";
import { GameView } from "./GameView";
import { PlayerView } from "./PlayerView";

/**
 * Convert engine TrainType (string enum) to renderer's numeric encoding.
 * UnitState uses 0/1/2 so it can be uploaded to GPU buffers without lookup.
 */
function trainTypeToNum(t: TrainType | undefined): number | null {
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

function numToTrainType(n: number | null): TrainType | undefined {
  switch (n) {
    case RendererTrainType.Engine:
      return TrainType.Engine;
    case RendererTrainType.TailEngine:
      return TrainType.TailEngine;
    case RendererTrainType.Carriage:
      return TrainType.Carriage;
    default:
      return undefined;
  }
}

/** Build a fresh UnitState from an incoming UnitUpdate. */
function unitStateFromUpdate(u: UnitUpdate): UnitState {
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
    markedForDeletion: u.markedForDeletion,
    health: u.health ?? null,
    underConstruction: u.underConstruction ?? false,
    targetUnitId: u.targetUnitId ?? null,
    targetTile: u.targetTile ?? null,
    troops: u.troops,
    missileTimerQueue: u.missileTimerQueue,
    level: u.level,
    hasTrainStation: u.hasTrainStation,
    trainType: trainTypeToNum(u.trainType),
    loaded: u.loaded ?? null,
    constructionStartTick: null, // GameView fills in createdAt when underConstruction
  };
}

/** Mutate `target` in place from a UnitUpdate, avoiding any allocation. */
function applyUpdateInPlace(target: UnitState, u: UnitUpdate): void {
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
  target.markedForDeletion = u.markedForDeletion;
  target.health = u.health ?? null;
  target.underConstruction = u.underConstruction ?? false;
  target.targetUnitId = u.targetUnitId ?? null;
  target.targetTile = u.targetTile ?? null;
  target.troops = u.troops;
  target.missileTimerQueue = u.missileTimerQueue;
  target.level = u.level;
  target.hasTrainStation = u.hasTrainStation;
  target.trainType = trainTypeToNum(u.trainType);
  target.loaded = u.loaded ?? null;
}

export class UnitView {
  public _wasUpdated = true;
  public lastPos: TileRef[] = [];
  /** Long-lived renderer state — mutated in place by update(). */
  public state: UnitState;
  /** Engine-only fields not in UnitState. Use warshipState() / transportShipState() to read. */
  private _warshipState?: WarshipState;
  private _transportShipState?: TransportShipState;
  private _createdAt: Tick;

  constructor(
    private gameView: GameView,
    data: UnitUpdate,
  ) {
    this.state = unitStateFromUpdate(data);
    this._warshipState = data.warshipState;
    this._transportShipState = data.transportShipState;
    this.lastPos.push(data.pos);
    this._createdAt = this.gameView.ticks();
    if (this.state.underConstruction) {
      this.state.constructionStartTick = this._createdAt;
    }
  }

  createdAt(): Tick {
    return this._createdAt;
  }

  wasUpdated(): boolean {
    return this._wasUpdated;
  }

  lastTiles(): TileRef[] {
    return this.lastPos;
  }

  lastTile(): TileRef {
    if (this.lastPos.length === 0) {
      return this.state.pos;
    }
    return this.lastPos[0];
  }

  update(data: UnitUpdate) {
    this.lastPos.push(data.pos);
    this._wasUpdated = true;
    const wasUnderConstruction = this.state.underConstruction;
    applyUpdateInPlace(this.state, data);
    this._warshipState = data.warshipState;
    this._transportShipState = data.transportShipState;
    // constructionStartTick: set on transition into underConstruction.
    if (this.state.underConstruction && !wasUnderConstruction) {
      this.state.constructionStartTick = this.gameView.ticks();
    } else if (!this.state.underConstruction) {
      this.state.constructionStartTick = null;
    }
  }

  applyDerivedPosition(pos: TileRef) {
    const prev = this.state.pos;
    this.lastPos.push(pos);
    this._wasUpdated = true;
    this.state.lastPos = prev;
    this.state.pos = pos;
  }

  /** Plan-driven unit stayed put this tick — its previous-tick position is
   *  its current one. Keeps lastPos→pos frame interpolation from replaying
   *  the prior segment. */
  applyDerivedRest() {
    this.state.lastPos = this.state.pos;
  }

  id(): number {
    return this.state.id;
  }

  targetable(): boolean {
    return this.state.targetable;
  }

  markedForDeletion(): number | false {
    return this.state.markedForDeletion;
  }

  type(): UnitType {
    return this.state.unitType as UnitType;
  }
  troops(): number {
    return this.state.troops;
  }
  warshipState(): WarshipState {
    if (this._warshipState === undefined) {
      throw new Error("warshipState called on non-warship unit");
    }
    return this._warshipState;
  }
  updateWarshipState(_update: Partial<WarshipState>): void {
    throw new Error("updateWarshipState is not supported on UnitView");
  }
  isInCombat(): boolean {
    return this._warshipState?.isInCombat ?? false;
  }
  touch(): void {
    throw new Error("touch is not supported on UnitView");
  }
  transportShipState(): TransportShipState {
    return this._transportShipState ?? { isRetreating: false, troops: 0 };
  }
  updateTransportShipState(
    _update: Pick<TransportShipState, "isRetreating">,
  ): void {
    throw new Error("updateTransportShipState is not supported on UnitView");
  }
  tile(): TileRef {
    return this.state.pos;
  }
  owner(): PlayerView {
    return this.gameView.playerBySmallID(this.state.ownerID)! as PlayerView;
  }
  isActive(): boolean {
    return this.state.isActive;
  }
  reachedTarget(): boolean {
    return this.state.reachedTarget;
  }
  hasHealth(): boolean {
    return this.state.health !== null;
  }
  health(): number {
    return this.state.health ?? 0;
  }
  isUnderConstruction(): boolean {
    return this.state.underConstruction;
  }
  isInCooldown(): boolean {
    return this.state.missileTimerQueue.length === this.state.level;
  }
  targetUnitId(): number | undefined {
    return this.state.targetUnitId ?? undefined;
  }
  targetTile(): TileRef | undefined {
    return this.state.targetTile ?? undefined;
  }

  // How "ready" this unit is from 0 to 1.
  missileReadinesss(): number {
    const maxMissiles = this.state.level;
    const missilesReloading = this.state.missileTimerQueue.length;

    if (missilesReloading === 0) {
      return 1;
    }

    const missilesReady = maxMissiles - missilesReloading;

    if (missilesReady === 0 && maxMissiles > 1) {
      // Unless we have just one missile (level 1),
      // show 0% readiness so user knows no missiles are ready.
      return 0;
    }

    let readiness = missilesReady / maxMissiles;

    const cooldownDuration =
      this.state.unitType === UnitType.SAMLauncher
        ? this.gameView.config().SAMCooldown()
        : this.gameView.config().SiloCooldown();

    for (const cooldown of this.state.missileTimerQueue) {
      const cooldownProgress = this.gameView.ticks() - cooldown;
      const cooldownRatio = cooldownProgress / cooldownDuration;
      const adjusted = cooldownRatio / maxMissiles;
      readiness += adjusted;
    }
    return readiness;
  }

  level(): number {
    return this.state.level;
  }
  hasTrainStation(): boolean {
    return this.state.hasTrainStation;
  }
  trainType(): TrainType | undefined {
    return numToTrainType(this.state.trainType);
  }
  isLoaded(): boolean | undefined {
    return this.state.loaded ?? undefined;
  }
  missileTimerQueue(): number[] {
    return this.state.missileTimerQueue;
  }
}
