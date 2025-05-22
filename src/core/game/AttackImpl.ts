import { Attack, Cell, Player, TerraNullius } from "./Game";
import { GameImpl } from "./GameImpl";
import { TileRef } from "./GameMap";
import { PlayerImpl } from "./PlayerImpl";

export class AttackImpl implements Attack {
  private _isActive = true;
  public _retreating = false;
  public _retreated = false;

  constructor(
    private _id: string,
    private _target: Player | TerraNullius,
    private _attacker: Player,
    private _troops: number,
    private _sourceTile: TileRef | null,
    private _border: Set<number>,
    private _mg: GameImpl,
  ) {}

  sourceTile(): TileRef | null {
    return this._sourceTile;
  }

  target(): Player | TerraNullius {
    return this._target;
  }
  attacker(): Player {
    return this._attacker;
  }
  troops(): number {
    return this._troops;
  }
  setTroops(troops: number) {
    this._troops = troops;
  }

  isActive() {
    return this._isActive;
  }

  id() {
    return this._id;
  }

  delete() {
    if (this._target.isPlayer()) {
      (this._target as PlayerImpl)._incomingAttacks = (
        this._target as PlayerImpl
      )._incomingAttacks.filter((a) => a !== this);
    }

    (this._attacker as PlayerImpl)._outgoingAttacks = (
      this._attacker as PlayerImpl
    )._outgoingAttacks.filter((a) => a !== this);

    this._isActive = false;
  }

  orderRetreat() {
    this._retreating = true;
  }

  executeRetreat() {
    this._retreated = true;
  }

  retreating(): boolean {
    return this._retreating;
  }

  retreated(): boolean {
    return this._retreated;
  }

  border(): Set<number> {
    return this._border;
  }

  averagePosition(): Cell | null {
    if (this._border.size === 0) {
      if (this.sourceTile() === null) {
        // No border tiles and no source tile—return a default position or throw an error
        return null;
      }
      // No border tiles yet—use the source tile's location
      const tile: number = this.sourceTile()!;
      return new Cell(this._mg.map().x(tile), this._mg.map().y(tile));
    }

    let averageX = 0;
    let averageY = 0;

    this._border.forEach((t) => {
      averageX += this._mg.map().x(t);
      averageY += this._mg.map().y(t);
    });

    averageX = averageX / this._border.size;
    averageY = averageY / this._border.size;

    return new Cell(averageX, averageY);
  }
}
