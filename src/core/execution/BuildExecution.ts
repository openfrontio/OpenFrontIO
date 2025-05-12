import { consolex } from "../Consolex";
import {
  Execution,
  Game,
  Player,
  TargetTileComp,
  Tick,
  Unit,
  UnitParams,
  UnitType,
} from "../game/Game";
import { BuildUnitIntent } from "../Schemas";
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

export class BuildExecution<T extends UnitType> implements Execution {
  private construction: Unit;
  private active: boolean = true;
  private mg: Game;

  private ticksUntilComplete: Tick;

  private cost: number;

  public constructor(
    private player: Player,
    private params: UnitParams<T> & TargetTileComp,
  ) {}

  public static FromIntent<T extends UnitType>(
    game: Game,
    type: T,
    owner: Player,
    intent: BuildUnitIntent,
  ): BuildExecution<T> {
    const dstTile = game.map().ref(intent.x, intent.y);
    switch (type) {
      case UnitType.Warship:
        return new BuildExecution<UnitType.Warship>(owner, {
          type: UnitType.Warship,
          warshipPatrolTile: dstTile,
          targetTile: dstTile,
        }) as BuildExecution<T>;

      case UnitType.TransportShip:
        if (intent.troops == null) {
          return null;
        }
        return new BuildExecution<UnitType.TransportShip>(owner, {
          type: UnitType.TransportShip,
          troops: intent.troops,
          targetTile: dstTile,
        }) as BuildExecution<T>;

      case UnitType.Port:
        return new BuildExecution<UnitType.Port>(owner, {
          type: UnitType.Port,
          targetTile: dstTile,
        }) as BuildExecution<T>;

      case UnitType.AtomBomb:
        return new BuildExecution<UnitType.AtomBomb>(owner, {
          type: UnitType.AtomBomb,
          detonationDst: dstTile,
          targetTile: dstTile,
        }) as BuildExecution<T>;

      case UnitType.HydrogenBomb:
        return new BuildExecution<UnitType.HydrogenBomb>(owner, {
          type: UnitType.HydrogenBomb,
          detonationDst: dstTile,
          targetTile: dstTile,
        }) as BuildExecution<T>;

      case UnitType.MissileSilo:
        return new BuildExecution<UnitType.MissileSilo>(owner, {
          type: UnitType.MissileSilo,
          cooldownDuration: 100,
          targetTile: dstTile,
        }) as BuildExecution<T>;

      case UnitType.DefensePost:
        return new BuildExecution<UnitType.DefensePost>(owner, {
          type: UnitType.DefensePost,
          targetTile: dstTile,
        }) as BuildExecution<T>;

      case UnitType.SAMLauncher:
        return new BuildExecution<UnitType.SAMLauncher>(owner, {
          type: UnitType.SAMLauncher,
          cooldownDuration: 100,
          targetTile: dstTile,
        }) as BuildExecution<T>;

      case UnitType.City:
        return new BuildExecution<UnitType.City>(owner, {
          type: UnitType.City,
          targetTile: dstTile,
        }) as BuildExecution<T>;

      case UnitType.MIRV:
        return new BuildExecution<UnitType.MIRV>(owner, {
          type: UnitType.MIRV,
          targetTile: dstTile,
        }) as BuildExecution<T>;

      // Following units cannot be built directly by human players.
      case UnitType.TradeShip:
      case UnitType.MIRVWarhead:
      case UnitType.Construction:
      case UnitType.SAMMissile:
      case UnitType.Shell:
        return null;
      default:
        assertNever(type);
    }
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.construction == null) {
      const info = this.mg.unitInfo(this.params.type);
      if (info.constructionDuration == null) {
        this.completeConstruction();
        this.active = false;
        return;
      }
      const spawnTile = this.player.canBuild(
        this.params.type,
        this.params.targetTile,
      );
      if (spawnTile == false) {
        consolex.warn(`cannot build ${this.params.type}`);
        this.active = false;
        return;
      }
      this.construction = this.player.buildUnit({
        type: UnitType.Construction,
        spawn: spawnTile,
      });
      this.cost = info.cost(this.player);
      this.player.removeGold(this.cost);
      this.construction.setConstructionType(this.params.type);
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
    const spawn = this.player.canBuild(
      this.params.type,
      this.params.targetTile,
    );
    if (spawn == false) {
      throw new Error(
        `BuildExecution: cannot build ${this.params.type} at ${this.params.targetTile}`,
      );
    }
    const unit = this.player.buildUnit({
      ...this.params,
      spawn,
    });

    switch (this.params.type) {
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
      case UnitType.MIRVWarhead:
        this.mg.addExecution(new NukeExecution(unit));
        break;
      case UnitType.MIRV:
        this.mg.addExecution(new MirvExecution(unit));
        break;
      case UnitType.Warship:
        this.mg.addExecution(new WarshipExecution(unit));
        break;
      case UnitType.Port:
        this.mg.addExecution(new PortExecution(unit));
        break;
      case UnitType.MissileSilo:
        this.mg.addExecution(new MissileSiloExecution(unit));
        break;
      case UnitType.DefensePost:
        this.mg.addExecution(new DefensePostExecution(unit));
        break;
      case UnitType.SAMLauncher:
        this.mg.addExecution(new SAMLauncherExecution(unit));
        break;
      case UnitType.City:
        this.mg.addExecution(new CityExecution(unit));
        break;
      case UnitType.TransportShip:
        this.mg.addExecution(new TransportShipExecution(unit));
        break;
      case UnitType.Shell:
        this.mg.addExecution(new ShellExecution(unit));
        break;
      case UnitType.SAMMissile:
        this.mg.addExecution(new SAMMissileExecution(unit));
        break;
      case UnitType.TradeShip:
        this.mg.addExecution(new TradeShipExecution(unit));
        break;
      case UnitType.Construction:
        throw new Error("Construction should not be built");
      default:
        assertNever(this.params);
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
