import { Execution, Game, MessageType, Unit, UnitType } from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { SAMMissileExecution } from "./SAMMissileExecution";

export class SAMLauncherExecution implements Execution {
  private mg: Game;

  private searchRangeRadius = 80;
  // As MIRV go very fast we have to detect them very early but we only
  // shoot the one targeting very close (MIRVWarheadProtectionRadius)
  private MIRVWarheadSearchRadius = 400;
  private MIRVWarheadProtectionRadius = 50;

  private pseudoRandom: PseudoRandom;

  constructor(private sam: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  private getSingleTarget(): Unit | null {
    const nukes = this.mg
      .nearbyUnits(this.sam.tile(), this.searchRangeRadius, [
        UnitType.AtomBomb,
        UnitType.HydrogenBomb,
      ])
      .filter(
        ({ unit }) =>
          unit.owner() !== this.sam.owner() &&
          !this.sam.owner().isFriendly(unit.owner()),
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
    if (!this.pseudoRandom) {
      this.pseudoRandom = new PseudoRandom(this.sam.id());
    }

    const mirvWarheadTargets = this.mg
      .nearbyUnits(
        this.sam.tile(),
        this.MIRVWarheadSearchRadius,
        UnitType.MIRVWarhead,
      )
      .map(({ unit }) => unit)
      .filter(
        (unit) =>
          unit.owner() !== this.sam.owner() &&
          !this.sam.owner().isFriendly(unit.owner()),
      )
      .filter(
        (unit) =>
          this.mg.manhattanDist(unit.detonationDst(), this.sam.tile()) <
          this.MIRVWarheadProtectionRadius,
      );

    let target: Unit | null = null;
    if (mirvWarheadTargets.length == 0) {
      target = this.getSingleTarget();
    }

    if (
      this.sam.isCooldown() &&
      this.sam.ticksLeftInCooldown(this.mg.config().SAMCooldown()) == 0
    ) {
      this.sam.setCooldown(false);
    }

    const isSingleTarget = target && !target.targetedBySAM();
    if (
      (isSingleTarget || mirvWarheadTargets.length > 0) &&
      !this.sam.isCooldown()
    ) {
      this.sam.setCooldown(true);
      const type =
        mirvWarheadTargets.length > 0 ? UnitType.MIRVWarhead : target.type();
      const random = this.pseudoRandom.next();
      const hit = this.isHit(type, random);
      if (!hit) {
        this.mg.displayMessage(
          `Missile failed to intercept ${type}`,
          MessageType.ERROR,
          this.sam.owner().id(),
        );
      } else {
        if (mirvWarheadTargets.length > 0) {
          // Message
          this.mg.displayMessage(
            `${mirvWarheadTargets.length} MIRV warheads intercepted`,
            MessageType.SUCCESS,
            this.sam.owner().id(),
          );
          // Delete warheads
          mirvWarheadTargets.forEach((u) => u.delete());
        } else {
          target.setTargetedBySAM(true);
          this.mg.addExecution(
            new SAMMissileExecution(
              this.sam.tile(),
              this.sam.owner(),
              this.sam,
              target,
            ),
          );
        }
      }
    }
  }

  isActive(): boolean {
    return this.sam.isActive();
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
