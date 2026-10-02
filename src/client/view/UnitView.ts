import {
  NukeState,
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
import { applyUnitUpdateInPlace, unitStateFromUpdate } from "./EntityState";
import { GameView } from "./GameView";
import { PlayerView } from "./PlayerView";

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

export class UnitView {
  public _wasUpdated = true;
  public lastPos: TileRef[] = [];
  /** Long-lived renderer state — mutated in place by update(). */
  public state: UnitState;
  /** Engine-only fields not in UnitState. Use warshipState() / transportShipState() to read. */
  private _warshipState?: WarshipState;
  private _transportShipState?: TransportShipState;
  private _nukeState?: NukeState;
  private _createdAt: Tick;

  constructor(
    private gameView: GameView,
    data: UnitUpdate,
  ) {
    this.state = unitStateFromUpdate(data);
    this._warshipState = data.warshipState;
    this._transportShipState = data.transportShipState;
    this._nukeState = data.nukeState;
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
    applyUnitUpdateInPlace(this.state, data);
    this._warshipState = data.warshipState;
    this._transportShipState = data.transportShipState;
    this._nukeState = data.nukeState;
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
  nukeState(): NukeState {
    if (this._nukeState === undefined) {
      throw new Error("nukeState called on non-nuke unit");
    }
    return this._nukeState;
  }
  updateNukeState(_update: NukeState): void {
    throw new Error("updateNukeState is not supported on UnitView");
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
  veterancy(): number {
    return this.state.veterancy;
  }
  recordKill(_targetType: UnitType): void {
    throw new Error("recordKill is not supported on UnitView");
  }
  recordTradeCapture(): void {
    throw new Error("recordTradeCapture is not supported on UnitView");
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
