import { MessageType, UnitSpecificInfos } from "./Game";
import { UnitUpdate } from "./GameUpdates";
import { GameUpdateType } from "./GameUpdates";
import { simpleHash, toInt, within, withinInt } from "../Util";
import { Unit, TerraNullius, UnitType, Player, UnitInfo } from "./Game";
import { GameImpl } from "./GameImpl";
import { PlayerImpl } from "./PlayerImpl";
import { TileRef } from "./GameMap";
import { consolex } from "../Consolex";

export class UnitImpl implements Unit {
  private _active = true;
  private _health: bigint;
  private _lastTile: TileRef = null;
  // Currently only warship use it
  private _target: Unit = null;
  private _moveTarget: TileRef = null;
  private _targetedBySAM = false;

  private _constructionType: UnitType = undefined;

  private _isSamCooldown: boolean = false;
  private _dstPort: Unit | null = null; // Only for trade ships
  private _detonationDst: TileRef | null = null; // Only for nukes
  private _warshipTarget: Unit | null = null;

  constructor(
    private _type: UnitType,
    private mg: GameImpl,
    private _tile: TileRef,
    private _troops: number,
    private _id: number,
    public _owner: PlayerImpl,
    unitsSpecificInfos: UnitSpecificInfos = {},
  ) {
    this._health = toInt(this.mg.unitInfo(_type).maxHealth ?? 1);
    this._lastTile = _tile;
    this._dstPort = unitsSpecificInfos.dstPort;
    this._detonationDst = unitsSpecificInfos.detonationDst;
    this._warshipTarget = unitsSpecificInfos.warshipTarget;
  }

  id() {
    return this._id;
  }

  toUpdate(): UnitUpdate {
    const warshipTarget = this.warshipTarget();
    const dstPort = this.dstPort();
    return {
      type: GameUpdateType.Unit,
      unitType: this._type,
      id: this._id,
      troops: this._troops,
      ownerID: this._owner.smallID(),
      isActive: this._active,
      pos: this._tile,
      lastPos: this._lastTile,
      health: this.hasHealth() ? Number(this._health) : undefined,
      constructionType: this._constructionType,
      dstPortId: dstPort ? dstPort.id() : null,
      warshipTargetId: warshipTarget ? warshipTarget.id() : null,
      detonationDst: this.detonationDst(),
      isSamCooldown: this.isSamCooldown() ? this.isSamCooldown() : null,
    };
  }

  type(): UnitType {
    return this._type;
  }

  lastTile(): TileRef {
    return this._lastTile;
  }

  move(tile: TileRef): void {
    if (tile == null) {
      throw new Error("tile cannot be null");
    }
    this._lastTile = this._tile;
    this._tile = tile;
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
    return this.info().maxHealth != undefined;
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

  setOwner(newOwner: Player): void {
    const oldOwner = this._owner;
    oldOwner._units = oldOwner._units.filter((u) => u != this);
    this._owner = newOwner as PlayerImpl;
    this.mg.addUpdate(this.toUpdate());
    this.mg.displayMessage(
      `Your ${this.type()} was captured by ${newOwner.displayName()}`,
      MessageType.ERROR,
      oldOwner.id(),
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
    this._owner._units = this._owner._units.filter((b) => b != this);
    this._active = false;
    this.mg.addUpdate(this.toUpdate());
    if (this.type() == UnitType.DefensePost) {
      this.mg.removeDefensePost(this);
    }
    if (displayMessage) {
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
    if (this.type() != UnitType.Construction) {
      throw new Error(`Cannot get construction type on ${this.type()}`);
    }
    return this._constructionType;
  }

  setConstructionType(type: UnitType): void {
    if (this.type() != UnitType.Construction) {
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

  warshipTarget(): Unit {
    return this._warshipTarget;
  }

  detonationDst(): TileRef {
    return this._detonationDst;
  }

  dstPort(): Unit {
    return this._dstPort;
  }

  setSamCooldown(cooldown: boolean): void {
    this._isSamCooldown = cooldown;
    this.mg.addUpdate(this.toUpdate());
  }

  isSamCooldown(): boolean {
    return this._isSamCooldown;
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
}
