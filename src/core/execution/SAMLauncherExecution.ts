import { consolex } from "../Consolex";
import {
  Execution,
  Game,
  MessageType,
  Player,
  PlayerID,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { SAMMissileExecution } from "./SAMMissileExecution";

export class SAMLauncherExecution implements Execution {
  private player: Player;
  private mg: Game;
  private active: boolean = true;

  private target: Unit = null;
  private warheadTargets: Unit[] = [];

  private searchRangeRadius = 80;
  // As MIRV go very fast we have to detect them very early but we only
  // shoot the one targeting very close (MIRVWarheadProtectionRadius)
  private MIRVWarheadSearchRadius = 400;
  private MIRVWarheadProtectionRadius = 50;

  private pseudoRandom: PseudoRandom;

  constructor(
    private ownerId: PlayerID,
    private tile: TileRef,
    private sam: Unit | null = null,
  ) {
    if (sam != null) {
      this.tile = sam.tile();
    }
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (!mg.hasPlayer(this.ownerId)) {
      console.warn(`SAMLauncherExecution: owner ${this.ownerId} not found`);
      this.active = false;
      return;
    }
    this.player = mg.player(this.ownerId);
  }

  private getSingleTarget(): Unit | null {
    const nukes = this.mg
      .nearbyUnits(this.sam.tile(), this.searchRangeRadius, [
        UnitType.AtomBomb,
        UnitType.HydrogenBomb,
      ])
      .filter(
        ({ unit }) =>
          unit.owner() !== this.player && !this.player.isFriendly(unit.owner()),
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
    if (type == UnitType.AtomBomb) {
      return true;
    }

    if (type == UnitType.MIRVWarhead) {
      return random < this.mg.config().samWarheadHittingChance();
    }

    return random < this.mg.config().samHittingChance();
  }

  tick(ticks: number): void {
    if (this.sam == null) {
      const spawnTile = this.player.canBuild(UnitType.SAMLauncher, this.tile);
      if (spawnTile == false) {
        consolex.warn("cannot build SAM Launcher");
        this.active = false;
        return;
      }
      this.sam = this.player.buildUnit(UnitType.SAMLauncher, 0, spawnTile, {
        cooldownDuration: this.mg.config().SAMCooldown(),
      });
    }
    if (!this.sam.isActive()) {
      this.active = false;
      return;
    }

    if (this.player != this.sam.owner()) {
      this.player = this.sam.owner();
    }

    if (!this.pseudoRandom) {
      this.pseudoRandom = new PseudoRandom(this.sam.id());
    }

    this.warheadTargets = this.mg
      .nearbyUnits(
        this.sam.tile(),
        this.MIRVWarheadSearchRadius,
        UnitType.MIRVWarhead,
      )
      .map(({ unit }) => unit)
      .filter(
        (unit) =>
          unit.owner() !== this.player && !this.player.isFriendly(unit.owner()),
      )
      .filter(
        (unit) =>
          this.mg.manhattanDist(unit.detonationDst(), this.sam.tile()) <
          this.MIRVWarheadProtectionRadius,
      );

    if (this.warheadTargets.length == 0) {
      this.target = this.getSingleTarget();
    }

    if (
      this.sam.isCooldown() &&
      this.sam.ticksLeftInCooldown(this.mg.config().SAMCooldown()) == 0
    ) {
      this.sam.setCooldown(false);
    }

    const isSingleTarget = this.target && !this.target.targetedBySAM();
    if (
      (isSingleTarget || this.warheadTargets.length > 0) &&
      !this.sam.isCooldown()
    ) {
      this.sam.setCooldown(true);
      const type =
        this.warheadTargets.length > 0
          ? UnitType.MIRVWarhead
          : this.target.type();
      const random = this.pseudoRandom.next();
      const hit = this.isHit(type, random);
      if (!hit) {
        this.mg.displayMessage(
          `Missile failed to intercept ${type}`,
          MessageType.ERROR,
          this.sam.owner().id(),
        );
      } else {
        if (this.warheadTargets.length > 0) {
          // Message
          this.mg.displayMessage(
            `${this.warheadTargets.length} MIRV warheads intercepted`,
            MessageType.SUCCESS,
            this.sam.owner().id(),
          );
          // Delete warheads
          this.warheadTargets.forEach((u) => u.delete());
        } else {
          this.target.setTargetedBySAM(true);
          this.mg.addExecution(
            new SAMMissileExecution(
              this.sam.tile(),
              this.sam.owner(),
              this.sam,
              this.target,
            ),
          );
          this.warheadTargets = [];
        }
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
