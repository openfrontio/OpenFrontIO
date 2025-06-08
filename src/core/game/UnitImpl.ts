import { simpleHash, toInt, withinInt } from "../Util";
import { translateText } from "../../client/Utils";
import {
  AllUnitParams,
  MessageType,
  Player,
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
  private _targetTile: TileRef | undefined;
  private _targetUnit: Unit | undefined;
  private _health: bigint;
  private _lastTile: TileRef;
  private _retreating: boolean = false;
  private _targetedBySAM = false;
  private _reachedTarget = false;
  private _lastSetSafeFromPirates: number; // Only for trade ships
  private _constructionType: UnitType | undefined;
  private _lastOwner: PlayerImpl | null = null;
  private _troops: number;
  private _cooldownStartTick: Tick | null = null;
  private _patrolTile: TileRef | undefined;
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
    this._targetTile =
      "targetTile" in params ? (params.targetTile ?? undefined) : undefined;
    this._troops = "troops" in params ? (params.troops ?? 0) : 0;
    this._lastSetSafeFromPirates =
      "lastSetSafeFromPirates" in params
        ? (params.lastSetSafeFromPirates ?? 0)
        : 0;
    this._patrolTile =
      "patrolTile" in params ? (params.patrolTile ?? undefined) : undefined;
    this._targetUnit =
      "targetUnit" in params ? (params.targetUnit ?? undefined) : undefined;

    switch (this._type) {
      case UnitType.Warship:
      case UnitType.Port:
      case UnitType.MissileSilo:
      case UnitType.DefensePost:
      case UnitType.SAMLauncher:
      case UnitType.City:
        this.mg.stats().unitBuild(_owner, this._type);
    }
  }

  setPatrolTile(tile: TileRef): void {
    this._patrolTile = tile;
  }

  patrolTile(): TileRef | undefined {
    return this._patrolTile;
  }

  isUnit(): this is Unit {
    return true;
  }

  touch(): void {
    this.mg.addUpdate(this.toUpdate());
  }
  setTileTarget(tile: TileRef | undefined): void {
    this._targetTile = tile;
  }
  tileTarget(): TileRef | undefined {
    return this._targetTile;
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
      lastOwnerID: this._lastOwner?.smallID(),
      isActive: this._active,
      reachedTarget: this._reachedTarget,
      retreating: this._retreating,
      pos: this._tile,
      lastPos: this._lastTile,
      health: this.hasHealth() ? Number(this._health) : undefined,
      constructionType: this._constructionType,
      targetUnitId: this._targetUnit?.id() ?? undefined,
      targetTile: this.targetTile() ?? undefined,
      ticksLeftInCooldown: this.ticksLeftInCooldown() ?? undefined,
    };
  }

  type(): UnitType {
    return this._type;
  }

  lastTile(): TileRef {
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
    switch (this._type) {
      case UnitType.Warship:
      case UnitType.Port:
      case UnitType.MissileSilo:
      case UnitType.DefensePost:
      case UnitType.SAMLauncher:
      case UnitType.City:
        this.mg.stats().unitCapture(newOwner, this._type);
        this.mg.stats().unitLose(this._owner, this._type);
        break;
    }
    this._lastOwner = this._owner;
    this._lastOwner._units = this._lastOwner._units.filter((u) => u !== this);
    this._owner = newOwner;
    this._owner._units.push(this);
    this.mg.addUpdate(this.toUpdate());
    this.mg.displayMessage(
      translateText("game_messages.unit_captured_by_enemy", {
        unitType: this.type(),
        playerName: newOwner.displayName(),
      }),
      MessageType.UNIT_CAPTURED_BY_ENEMY,
      this._lastOwner.id(),
    );
    this.mg.displayMessage(
      translateText("game_messages.captured_enemy_unit", {
        unitType: this.type(),
        playerName: this._lastOwner.displayName(),
      }),
      MessageType.CAPTURED_ENEMY_UNIT,
      newOwner.id(),
    );
  }

  modifyHealth(delta: number, attacker?: Player): void {
    this._health = withinInt(
      this._health + toInt(delta),
      0n,
      toInt(this.info().maxHealth ?? 1),
    );
    if (this._health === 0n) {
      this.delete(true, attacker);
    }
  }

  delete(displayMessage?: boolean, destroyer?: Player): void {
    if (!this.isActive()) {
      throw new Error(`cannot delete ${this} not active`);
    }
    this._owner._units = this._owner._units.filter((b) => b !== this);
    this._active = false;
    this.mg.addUpdate(this.toUpdate());
    this.mg.removeUnit(this);
    if (displayMessage !== false && this._type !== UnitType.MIRVWarhead) {
      this.mg.displayMessage(
        translateText("game_messages.unit_destroyed", {
          unitType: this._type,
        }),
        MessageType.UNIT_DESTROYED,
        this.owner().id(),
      );
    }
    if (destroyer !== undefined) {
      switch (this._type) {
        case UnitType.TransportShip:
          this.mg
            .stats()
            .boatDestroyTroops(destroyer, this._owner, this._troops);
          break;
        case UnitType.TradeShip:
          this.mg.stats().boatDestroyTrade(destroyer, this._owner);
          break;
        case UnitType.City:
        case UnitType.DefensePost:
        case UnitType.MissileSilo:
        case UnitType.Port:
        case UnitType.SAMLauncher:
        case UnitType.Warship:
          this.mg.stats().unitDestroy(destroyer, this._type);
          this.mg.stats().unitLose(this.owner(), this._type);
          break;
      }
    }
  }

  isActive(): boolean {
    return this._active;
  }

  retreating(): boolean {
    return this._retreating;
  }

  orderBoatRetreat() {
    if (this.type() !== UnitType.TransportShip) {
      throw new Error(`Cannot retreat ${this.type()}`);
    }
    this._retreating = true;
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

  launch(): void {
    this._cooldownStartTick = this.mg.ticks();
    this.mg.addUpdate(this.toUpdate());
  }

  ticksLeftInCooldown(): Tick | undefined {
    let cooldownDuration = 0;
    if (this.type() === UnitType.SAMLauncher) {
      cooldownDuration = this.mg.config().SAMCooldown();
    } else if (this.type() === UnitType.MissileSilo) {
      cooldownDuration = this.mg.config().SiloCooldown();
    } else {
      return undefined;
    }

    if (!this._cooldownStartTick) {
      return undefined;
    }

    return cooldownDuration - (this.mg.ticks() - this._cooldownStartTick);
  }

  isInCooldown(): boolean {
    const ticksLeft = this.ticksLeftInCooldown();
    return ticksLeft !== undefined && ticksLeft > 0;
  }

  setTargetTile(targetTile: TileRef | undefined) {
    this._targetTile = targetTile;
  }

  targetTile(): TileRef | undefined {
    return this._targetTile;
  }

  setTargetUnit(target: Unit | undefined): void {
    this._targetUnit = target;
  }

  targetUnit(): Unit | undefined {
    return this._targetUnit;
  }

  setTargetedBySAM(targeted: boolean): void {
    this._targetedBySAM = targeted;
  }

  targetedBySAM(): boolean {
    return this._targetedBySAM;
  }

  setReachedTarget(): void {
    this._reachedTarget = true;
  }

  reachedTarget(): boolean {
    return this._reachedTarget;
  }

  setSafeFromPirates(): void {
    this._lastSetSafeFromPirates = this.mg.ticks();
  }

  isSafeFromPirates(): boolean {
    return (
      this.mg.ticks() - this._lastSetSafeFromPirates <
      this.mg.config().safeFromPiratesCooldownMax()
    );
  }
}
