import { MessageType } from "./Game";
import { UnitUpdate } from "./GameUpdates";
import { GameUpdateType } from "./GameUpdates";
import { simpleHash, toInt, within, withinInt } from "../Util";
import { Unit, TerraNullius, UnitType, Player, UnitInfo } from "./Game";
import { GameImpl } from "./GameImpl";
import { PlayerImpl } from "./PlayerImpl";
import { TileRef } from "./GameMap";

export class UnitImpl implements Unit {
  private _active = true;
  private _health: bigint;
  private _lastTile: TileRef = null;
  // Currently only warship use it
  private _target: Unit = null;

  private _constructionType: UnitType = undefined;

  constructor(
    private _type: UnitType,
    private mg: GameImpl,
    private _tile: TileRef,
    private _troops: number,
    private _id: number,
    public _owner: PlayerImpl,
    private _dstPort?: Unit,
  ) {
    // default to 60% health (or 1.2 is no health specified)
    this._health = toInt((this.mg.unitInfo(_type).maxHealth ?? 2) * 0.6);
    this._lastTile = _tile;
  }

  id() {
    return this._id;
  }

  toUpdate(): UnitUpdate {
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
      targetId: this.target() ? this.target().id() : null,
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

  dstPort(): Unit {
    return this._dstPort;
  }

  setTarget(target: Unit) {
    this._target = target;
  }

  target() {
    return this._target;
  }
}
