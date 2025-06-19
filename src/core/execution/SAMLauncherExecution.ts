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

export class SAMLauncherExecution implements Execution {
  private mg: Game;
  private active: boolean = true;

  private searchRangeRadius = 80;
  private targetRangeRadius = 120; // Nuke's target should be in this range to be focusable
  // As MIRV go very fast we have to detect them very early but we only
  // shoot the one targeting very close (MIRVWarheadProtectionRadius)
  private MIRVWarheadSearchRadius = 400;
  private MIRVWarheadProtectionRadius = 50;

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

  private getSingleTarget(): Unit | null {
    if (this.sam === null) return null;
    const nukes = this.mg.nearbyUnits(
      this.sam.tile(),
      this.searchRangeRadius,
      [UnitType.AtomBomb, UnitType.HydrogenBomb],
      ({ unit }) =>
        unit.owner() !== this.player &&
        !this.player.isFriendly(unit.owner()) &&
        unit.isTargetable(),
    );

    return (
      nukes.sort((a, b) => {
        const { unit: unitA, distSquared: distA } = a;
        const { unit: unitB, distSquared: distB } = b;

        // Prioritize Hydrogen Bombs
        if (
          unitA.type() === UnitType.HydrogenBomb &&
          unitB.type() !== UnitType.HydrogenBomb
        )
          return -1;
        if (
          unitA.type() !== UnitType.HydrogenBomb &&
          unitB.type() === UnitType.HydrogenBomb
        )
          return 1;

        // If both are the same type, sort by distance (lower `distSquared` means closer)
        return distA - distB;
      })[0]?.unit ?? null
    );
  }

  private isHit(type: UnitType, random: number): boolean {
    if (type === UnitType.AtomBomb) {
      return true;
    }

    if (type === UnitType.MIRVWarhead) {
      return random < this.mg.config().samWarheadHittingChance();
    }

    return random < this.mg.config().samHittingChance();
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
      this.sam = this.player.buildUnit(UnitType.SAMLauncher, spawnTile, {
        cooldownDuration: this.mg.config().SAMCooldown(),
      });
    }
    if (!this.sam.isActive()) {
      this.active = false;
      return;
    }

    if (this.player !== this.sam.owner()) {
      this.player = this.sam.owner();
    }

    if (this.pseudoRandom === undefined) {
      this.pseudoRandom = new PseudoRandom(this.sam.id());
    }

    const mirvWarheadTargets = this.mg.nearbyUnits(
      this.sam.tile(),
      this.MIRVWarheadSearchRadius,
      UnitType.MIRVWarhead,
      ({ unit }) => {
        if (unit.owner() === this.player) return false;
        if (this.player.isFriendly(unit.owner())) return false;
        const dst = unit.targetTile();
        return (
          this.sam !== null &&
          dst !== undefined &&
          this.mg.manhattanDist(dst, this.sam.tile()) <
            this.MIRVWarheadProtectionRadius
        );
      },
    );

    let target: Unit | null = null;
    if (mirvWarheadTargets.length === 0) {
      target = this.getSingleTarget();
    }

    const isSingleTarget = target && !target.targetedBySAM();
    if (
      (isSingleTarget || mirvWarheadTargets.length > 0) &&
      !this.sam.isInCooldown()
    ) {
      this.sam.launch();
      const type =
        mirvWarheadTargets.length > 0 ? UnitType.MIRVWarhead : target?.type();
      if (type === undefined) throw new Error("Unknown unit type");
      const random = this.pseudoRandom.next();
      const hit = this.isHit(type, random);
      if (!hit) {
        this.mg.displayMessage(
          `Missile failed to intercept ${type}`,
          MessageType.SAM_MISS,
          this.sam.owner().id(),
        );
      } else if (mirvWarheadTargets.length > 0) {
        const samOwner = this.sam.owner();

        // Message
        this.mg.displayMessage(
          `${mirvWarheadTargets.length} MIRV warheads intercepted`,
          MessageType.SAM_HIT,
          samOwner.id(),
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
        target.setTargetedBySAM(true);
        this.mg.addExecution(
          new SAMMissileExecution(
            this.sam.tile(),
            this.sam.owner(),
            this.sam,
            target,
          ),
        );
      } else {
        throw new Error("target is null");
      }
    }

    const frontTime = this.sam.ticksLeftInCooldown();
    if (frontTime === undefined) {
      return;
    }

    const cooldown =
      this.mg.config().SAMCooldown() - (this.mg.ticks() - frontTime);
    if (typeof cooldown === "number" && cooldown >= 0) {
      this.sam.touch();
    }

    if (cooldown <= 0) {
      this.sam.reloadMissile();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
