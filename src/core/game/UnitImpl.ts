import { simpleHash, toInt, withinInt } from "../Util";
import {
  AllUnitParams,
  MessageType,
  Tick,
  Unit,
  UnitInfo,
  UnitType,
} from "./Game";
import { GameImpl } from "./GameImpl";
import { TileRef } from "./GameMap";
import { GameUpdateType, UnitUpdate } from "./GameUpdates";
import { PlayerImpl } from "./PlayerImpl";

export class UnitImpl implements Unit {
  private _active = true;
  private _health: bigint;
  private _lastTile: TileRef;
  private _moveTarget: TileRef | null = null;
  private _targetedBySAM = false;
  private _safeFromPiratesCooldown: number; // Only for trade ships
  private _lastSetSafeFromPirates: number; // Only for trade ships
  private _constructionType: UnitType | undefined;
  private _lastOwner: PlayerImpl | null = null;
  private _troops: number;
  private _cooldownTick: Tick | null = null;
  private _dstPort: Unit | undefined = undefined; // Only for trade ships
  private _detonationDst: TileRef | undefined = undefined; // Only for nukes
  private _warshipTarget: Unit | undefined = undefined;
  private _cooldownDuration: number | undefined = undefined;

  constructor(
    private _type: UnitType,
    private mg: GameImpl,
    private _tile: TileRef,
    private _id: number,
    public _owner: PlayerImpl,
    params: AllUnitParams = {},
  ) {
    this._lastTile = _tile;
    this._health = toInt(this.mg.unitInfo(_type).maxHealth ?? 1);
    this._safeFromPiratesCooldown = this.mg
      .config()
      .safeFromPiratesCooldownMax();

    this._troops = "troops" in params ? (params.troops ?? 0) : 0;
    this._dstPort = "dstPort" in params ? params.dstPort : undefined;
    this._cooldownDuration =
      "cooldownDuration" in params ? params.cooldownDuration : undefined;
    this._lastSetSafeFromPirates =
      "lastSetSafeFromPirates" in params
        ? (params.lastSetSafeFromPirates ?? 0)
        : 0;
  }

  id() {
    return this._id;
  }

  toUpdate(): UnitUpdate {
    const warshipTarget = this.warshipTarget();
    const dstPort = this.dstPort();
    if (this._lastTile === null) throw new Error("null _lastTile");
    const ticksLeftInCooldown =
      this._cooldownDuration !== undefined
        ? this.ticksLeftInCooldown(this._cooldownDuration)
        : undefined;
    return {
      type: GameUpdateType.Unit,
      unitType: this._type,
      id: this._id,
      troops: this._troops,
      ownerID: this._owner.smallID(),
      lastOwnerID: this._lastOwner?.smallID(),
      isActive: this._active,
      pos: this._tile,
      lastPos: this._lastTile,
      health: this.hasHealth() ? Number(this._health) : undefined,
      constructionType: this._constructionType,
      dstPortId: dstPort?.id() ?? undefined,
      warshipTargetId: warshipTarget?.id() ?? undefined,
      detonationDst: this.detonationDst() ?? undefined,
      ticksLeftInCooldown,
    };
  }

  type(): UnitType {
    return this._type;
  }

  lastTile(): TileRef {
    if (this._lastTile === null) throw new Error("null _lastTile");
    return this._lastTile;
  }

  move(tile: TileRef): void {
    if (tile === null) {
      throw new Error("tile cannot be null");
    }
    this.mg.removeUnit(this);
    this._lastTile = this._tile;
    this._tile = tile;
    this.mg.addUnit(this);
    this.mg.addUpdate(this.toUpdate());
  }
  setTroops(troops: number): void {
    this._troops = troops;
  }
  troops(): number {
    return this._troops;
  }
  health(): number {
    return Number(this._health);
  }
  hasHealth(): boolean {
    return this.info().maxHealth !== undefined;
  }
  tile(): TileRef {
    return this._tile;
  }
  owner(): PlayerImpl {
    return this._owner;
  }

  info(): UnitInfo {
    return this.mg.unitInfo(this._type);
  }

  setOwner(newOwner: PlayerImpl): void {
    this._lastOwner = this._owner;
    this._lastOwner._units = this._lastOwner._units.filter((u) => u !== this);
    this._owner = newOwner;
    this._owner._units.push(this);
    this.mg.addUpdate(this.toUpdate());
    this.mg.displayMessage(
      `Your ${this.type()} was captured by ${newOwner.displayName()}`,
      MessageType.ERROR,
      this._lastOwner.id(),
    );
    this.mg.displayMessage(
      `Captured ${this.type()} from ${this._lastOwner.displayName()}`,
      MessageType.SUCCESS,
      newOwner.id(),
    );
  }

  modifyHealth(delta: number): void {
    this._health = withinInt(
      this._health + toInt(delta),
      0n,
      toInt(this.info().maxHealth ?? 1),
    );
  }

  delete(displayMessage: boolean = true): void {
    if (!this.isActive()) {
      throw new Error(`cannot delete ${this} not active`);
    }
    this._owner._units = this._owner._units.filter((b) => b !== this);
    this._active = false;
    this.mg.addUpdate(this.toUpdate());
    this.mg.removeUnit(this);
    if (displayMessage && this.type() !== UnitType.MIRVWarhead) {
      this.mg.displayMessage(
        `Your ${this.type()} was destroyed`,
        MessageType.ERROR,
        this.owner().id(),
      );
    }
  }
  isActive(): boolean {
    return this._active;
  }

  constructionType(): UnitType | null {
    if (this.type() !== UnitType.Construction) {
      throw new Error(`Cannot get construction type on ${this.type()}`);
    }
    return this._constructionType ?? null;
  }

  setConstructionType(type: UnitType): void {
    if (this.type() !== UnitType.Construction) {
      throw new Error(`Cannot set construction type on ${this.type()}`);
    }
    this._constructionType = type;
    this.mg.addUpdate(this.toUpdate());
  }

  hash(): number {
    return this.tile() + simpleHash(this.type()) * this._id;
  }

  toString(): string {
    return `Unit:${this._type},owner:${this.owner().name()}`;
  }

  setWarshipTarget(target: Unit) {
    this._warshipTarget = target;
  }

  warshipTarget(): Unit | null {
    return this._warshipTarget ?? null;
  }

  detonationDst(): TileRef | null {
    return this._detonationDst ?? null;
  }

  dstPort(): Unit | null {
    return this._dstPort ?? null;
  }

  // set the cooldown to the current tick or remove it
  setCooldown(triggerCooldown: boolean): void {
    if (triggerCooldown) {
      this._cooldownTick = this.mg.ticks();
      this.mg.addUpdate(this.toUpdate());
    } else {
      this._cooldownTick = null;
      this.mg.addUpdate(this.toUpdate());
    }
  }

  ticksLeftInCooldown(cooldownDuration: number): Tick {
    const cooldownTick = this._cooldownTick ?? 0;
    return Math.max(0, cooldownDuration - (this.mg.ticks() - cooldownTick));
  }

  isCooldown(): boolean {
    return this._cooldownTick ? true : false;
  }

  setDstPort(dstPort: Unit): void {
    this._dstPort = dstPort;
  }

  setMoveTarget(moveTarget: TileRef) {
    this._moveTarget = moveTarget;
  }

  moveTarget(): TileRef | null {
    return this._moveTarget;
  }

  setTargetedBySAM(targeted: boolean): void {
    this._targetedBySAM = targeted;
  }

  targetedBySAM(): boolean {
    return this._targetedBySAM;
  }

  setSafeFromPirates(): void {
    this._lastSetSafeFromPirates = this.mg.ticks();
  }

  isSafeFromPirates(): boolean {
    return (
      this.mg.ticks() - this._lastSetSafeFromPirates <
      this._safeFromPiratesCooldown
    );
  }
}
