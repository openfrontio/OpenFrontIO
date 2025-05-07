import { simpleHash } from "../Util";
import {
  MessageType,
  Player,
  Unit,
  UnitAttrs,
  UnitInfo,
  UnitType,
} from "./Game";
import { GameImpl } from "./GameImpl";
import { TileRef } from "./GameMap";
import { GameUpdateType, UnitUpdate } from "./GameUpdates";
import { PlayerImpl } from "./PlayerImpl";

export class UnitImpl<T extends UnitType> implements Unit<T> {
  private _active = true;
  private _lastTile: TileRef = null;

  constructor(
    private mg: GameImpl,
    private _tile: TileRef,
    private _id: number,
    public _owner: PlayerImpl,
    private _unitInfo: UnitInfo<T>,
  ) {
    this._lastTile = _tile;
  }

  id() {
    return this._id;
  }

  toUpdate(): UnitUpdate {
    return {
      type: GameUpdateType.Unit,
      unitType: this._unitInfo.type,
      unitInfo: this._unitInfo,
      id: this._id,
      ownerID: this._owner.smallID(),
      isActive: this._active,
      pos: this._tile,
      lastPos: this._lastTile,
    };
  }

  // Fix 1: Type property is now a field, not a method
  get type(): T {
    return this._unitInfo.type as T;
  }

  // Fix 2: Add info method to match the Unit interface
  info(): UnitInfo<T> {
    return this._unitInfo;
  }

  lastTile(): TileRef {
    return this._lastTile;
  }

  move(tile: TileRef): void {
    if (tile == null) {
      throw new Error("tile cannot be null");
    }
    this.mg.removeUnit(this);
    this._lastTile = this._tile;
    this._tile = tile;
    this.mg.addUnit(this);
    this.mg.addUpdate(this.toUpdate());
  }

  tile(): TileRef {
    return this._tile;
  }

  owner(): PlayerImpl {
    return this._owner;
  }

  attrs(): UnitAttrs {
    return this.mg.unitInfo(this._unitInfo.type);
  }

  setOwner(newOwner: Player): void {
    const oldOwner = this._owner;
    oldOwner._units = oldOwner._units.filter((u) => u != this);
    this._owner = newOwner as PlayerImpl;
    this.mg.addUpdate(this.toUpdate());
    this.mg.displayMessage(
      `Your ${this.type} was captured by ${newOwner.displayName()}`,
      MessageType.ERROR,
      oldOwner.id(),
    );
  }

  delete(displayMessage: boolean = true): void {
    if (!this.isActive()) {
      throw new Error(`cannot delete ${this} not active`);
    }
    this._owner._units = this._owner._units.filter((b) => b != this);
    this._active = false;
    this.mg.addUpdate(this.toUpdate());
    this.mg.removeUnit(this);
    if (displayMessage && this.type != UnitType.MIRVWarhead) {
      this.mg.displayMessage(
        `Your ${this.type} was destroyed`,
        MessageType.ERROR,
        this.owner().id(),
      );
    }
  }

  isActive(): boolean {
    return this._active;
  }

  hash(): number {
    return this.tile() + simpleHash(this.type) * this._id;
  }

  toString(): string {
    return `Unit:${this._unitInfo.type},owner:${this.owner().name()}`;
  }
}
