import { consolex } from "../Consolex";
import {
  Execution,
  Game,
  Player,
  Tick,
  Unit,
  UnitArgs,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { assertNever } from "../Util";
import { CityExecution } from "./CityExecution";
import { DefensePostExecution } from "./DefensePostExecution";
import { MirvExecution } from "./MIRVExecution";
import { MissileSiloExecution } from "./MissileSiloExecution";
import { NukeExecution } from "./NukeExecution";
import { PortExecution } from "./PortExecution";
import { SAMLauncherExecution } from "./SAMLauncherExecution";
import { SAMMissileExecution } from "./SAMMissileExecution";
import { ShellExecution } from "./ShellExecution";
import { TradeShipExecution } from "./TradeShipExecution";
import { TransportShipExecution } from "./TransportShipExecution";
import { WarshipExecution } from "./WarshipExecution";

export class BuildExecution implements Execution {
  private construction: Unit;
  private active: boolean = true;
  private mg: Game;

  private ticksUntilComplete: Tick;

  constructor(
    private player: Player,
    private tile: TileRef,
    private constructionType: UnitType,
    private unitArgs: UnitArgs = {},
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.construction == null) {
      const info = this.mg.unitInfo(this.constructionType);
      if (info.constructionDuration == null) {
        this.completeBuild();
        this.active = false;
        return;
      }
      const spawnTile = this.player.canBuild(this.constructionType, this.tile);
      if (spawnTile == false) {
        consolex.warn(`cannot build ${this.constructionType}`);
        this.active = false;
        return;
      }
      this.construction = this.player.buildUnit(
        UnitType.Construction,
        spawnTile,
      );
      this.construction.setConstructionType(this.constructionType);
      this.ticksUntilComplete = info.constructionDuration;
      return;
    }

    if (!this.construction.isActive()) {
      this.active = false;
      return;
    }

    if (this.player != this.construction.owner()) {
      this.player = this.construction.owner();
    }

    if (this.ticksUntilComplete == 0) {
      this.player = this.construction.owner();
      this.construction.delete(false);
      this.completeBuild();
      this.active = false;
      return;
    }
    this.ticksUntilComplete--;
  }

  private payCost() {
    const cost = this.mg.unitInfo(this.constructionType).cost(this.player);
    this.player.removeGold(cost);
    const troops = ;
  }

  private completeBuild() {
    switch (this.constructionType) {
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
      case UnitType.MIRVWarhead:
        this.mg.addExecution(new NukeExecution(this.construction));
        break;
      case UnitType.MIRV:
        this.mg.addExecution(new MirvExecution(this.construction));
        break;
      case UnitType.Warship:
        this.mg.addExecution(new WarshipExecution(this.construction));
        break;
      case UnitType.Port:
        this.mg.addExecution(new PortExecution(this.construction));
        break;
      case UnitType.MissileSilo:
        this.mg.addExecution(new MissileSiloExecution(this.construction));
        break;
      case UnitType.DefensePost:
        this.mg.addExecution(new DefensePostExecution(this.construction));
        break;
      case UnitType.SAMLauncher:
        this.mg.addExecution(new SAMLauncherExecution(this.construction));
        break;
      case UnitType.City:
        this.mg.addExecution(new CityExecution(this.construction));
        break;
      case UnitType.TransportShip:
        this.mg.addExecution(new TransportShipExecution(this.construction));
        break;
      case UnitType.Shell:
        this.mg.addExecution(new ShellExecution(this.construction));
        break;
      case UnitType.SAMMissile:
        this.mg.addExecution(new SAMMissileExecution(this.construction));
        break;
      case UnitType.TradeShip:
        this.mg.addExecution(new TradeShipExecution(this.construction));
        break;
      case UnitType.Construction:
        throw Error(
          `building unit type ${this.constructionType} not supported`,
        );
      default:
        assertNever(this.constructionType);
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
