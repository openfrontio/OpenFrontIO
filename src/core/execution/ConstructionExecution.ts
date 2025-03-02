import { consolex } from "../Consolex";
import {
  Execution,
  Game,
  Player,
  PlayerID,
  Tick,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { CityExecution } from "./CityExecution";
import { DefensePostExecution } from "./DefensePostExecution";
import { MirvExecution } from "./MIRVExecution";
import { MissileSiloExecution } from "./MissileSiloExecution";
import { NukeExecution } from "./NukeExecution";
import { PortExecution } from "./PortExecution";
import { WarshipExecution } from "./WarshipExecution";

export class ConstructionExecution implements Execution {
  private player: Player;
  private construction: Unit;
  private active: boolean = true;
  private mg: Game;

  private ticksUntilComplete: Tick;

  private cost: number;

  constructor(
    private ownerId: PlayerID,
    private tile: TileRef,
    private constructionType: UnitType,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (!mg.hasPlayer(this.ownerId)) {
      console.warn(`ConstructionExecution: owner ${this.ownerId} not found`);
      this.active = false;
      return;
    }
    this.player = mg.player(this.ownerId);
  }

  tick(ticks: number): void {
    if (this.construction == null) {
      const info = this.mg.unitInfo(this.constructionType);
      if (info.constructionDuration == null) {
        this.completeConstruction();
        this.active = false;
        return;
      }
      const spawnTile = this.player.canBuild(this.constructionType, this.tile);
      if (spawnTile == false) {
        consolex.warn(`cannot build ${UnitType.Construction}`);
        this.active = false;
        return;
      }
      this.construction = this.player.buildUnit(
        UnitType.Construction,
        0,
        spawnTile,
      );
      this.cost = this.mg.unitInfo(this.constructionType).cost(this.player);
      this.player.removeGold(this.cost);
      this.construction.setConstructionType(this.constructionType);
      this.ticksUntilComplete = info.constructionDuration;
      return;
    }

    if (!this.construction.isActive()) {
      this.active = false;
      return;
    }

    if (this.ticksUntilComplete == 0) {
      this.player = this.construction.owner();
      this.construction.delete(false);
      // refund the cost so player has the gold to build the unit
      this.player.addGold(this.cost);
      this.completeConstruction();
      this.active = false;
      return;
    }
    this.ticksUntilComplete--;
  }

  private completeConstruction() {
    const player = this.player;
    switch (this.constructionType) {
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
        this.mg.addExecution(
          new NukeExecution(this.constructionType, player.id(), this.tile),
        );
        break;
      case UnitType.MIRV:
        this.mg.addExecution(new MirvExecution(player.id(), this.tile));
        break;
      case UnitType.Warship:
        this.mg.addExecution(new WarshipExecution(player.id(), this.tile));
        break;
      case UnitType.Port:
        this.mg.addExecution(new PortExecution(player.id(), this.tile));
        break;
      case UnitType.MissileSilo:
        this.mg.addExecution(new MissileSiloExecution(player.id(), this.tile));
        break;
      case UnitType.DefensePost:
        this.mg.addExecution(new DefensePostExecution(player.id(), this.tile));
        break;
      case UnitType.City:
        this.mg.addExecution(new CityExecution(player.id(), this.tile));
        break;
      default:
        throw Error(`unit type ${this.constructionType} not supported`);
    }
  }

  owner(): Player {
    return null;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
