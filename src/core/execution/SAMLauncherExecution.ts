import {
  Execution,
  Game,
  MessageType,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { SAMMissileExecution } from "./SAMMissileExecution";
import {
  AirDefenseTarget,
  AirDefenseTargetingSystem,
  findMirvWarheadTargets,
} from "./utils/AirDefenseUtils";

export class SAMLauncherExecution implements Execution {
  private mg: Game;
  private active: boolean = true;

  // As MIRV go very fast we have to detect them very early but we only
  // shoot the one targeting very close (MIRVWarheadProtectionRadius)
  private MIRVWarheadSearchRadius = 400;
  private MIRVWarheadProtectionRadius = 50;
  private targetingSystem: AirDefenseTargetingSystem;

  private pseudoRandom: PseudoRandom | undefined;

  constructor(
    private player: Player,
    private tile: TileRef | null,
    private sam: Unit | null = null,
  ) {
    if (sam !== null) {
      this.tile = sam.tile();
    }
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.mg === null || this.player === null) {
      throw new Error("Not initialized");
    }
    if (this.sam === null) {
      if (this.tile === null) {
        throw new Error("tile is null");
      }
      const spawnTile = this.player.canBuild(UnitType.SAMLauncher, this.tile);
      if (spawnTile === false) {
        console.warn("cannot build SAM Launcher");
        this.active = false;
        return;
      }
      this.sam = this.player.buildUnit(UnitType.SAMLauncher, spawnTile, {});
    }
    this.targetingSystem ??= new AirDefenseTargetingSystem(this.mg, this.sam);

    if (this.sam.isUnderConstruction()) {
      return;
    }

    if (this.sam.isInCooldown()) {
      const frontTime = this.sam.missileTimerQueue()[0];
      if (frontTime === undefined) {
        return;
      }
      const cooldown =
        this.mg.config().SAMCooldown() - (this.mg.ticks() - frontTime);

      if (cooldown <= 0) {
        this.sam.reloadMissile();
      }
      return;
    }

    if (!this.sam.isActive()) {
      this.active = false;
      return;
    }

    if (this.player !== this.sam.owner()) {
      this.player = this.sam.owner();
    }

    this.pseudoRandom ??= new PseudoRandom(this.sam.id());

    const mirvWarheadTargets = findMirvWarheadTargets(
      this.mg,
      this.sam,
      (unit, interceptor, game) => {
        const dst = unit.targetTile();
        return (
          dst !== undefined &&
          game.manhattanDist(dst, interceptor.tile()) <
            this.MIRVWarheadProtectionRadius
        );
      },
      this.MIRVWarheadSearchRadius,
    );

    let target: AirDefenseTarget | null = null;
    if (mirvWarheadTargets.length === 0) {
      target = this.targetingSystem.getSingleTarget(ticks);
    }

    // target is already filtered to exclude nukes targeted by other SAMs
    if (target || mirvWarheadTargets.length > 0) {
      this.sam.launch();
      const type =
        mirvWarheadTargets.length > 0
          ? UnitType.MIRVWarhead
          : target?.unit.type();
      if (type === undefined) throw new Error("Unknown unit type");
      if (mirvWarheadTargets.length > 0) {
        const samOwner = this.sam.owner();

        // Message
        this.mg.displayMessage(
          "events_display.mirv_warheads_intercepted",
          MessageType.SAM_HIT,
          samOwner.id(),
          undefined,
          { count: mirvWarheadTargets.length },
        );

        mirvWarheadTargets.forEach(({ unit: u }) => {
          // Delete warheads
          u.delete();
        });

        // Record stats
        this.mg
          .stats()
          .bombIntercept(
            samOwner,
            UnitType.MIRVWarhead,
            mirvWarheadTargets.length,
          );
      } else if (target !== null) {
        target.unit.setTargetedBySAM(true);
        this.mg.addExecution(
          new SAMMissileExecution(
            this.sam.tile(),
            this.sam.owner(),
            this.sam,
            target.unit,
            target.tile,
          ),
        );
      } else {
        throw new Error("target is null");
      }
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
