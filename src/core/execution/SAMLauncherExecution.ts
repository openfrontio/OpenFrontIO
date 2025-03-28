import { consolex } from "../Consolex";
import {
  Cell,
  Execution,
  Game,
  Player,
  Unit,
  PlayerID,
  UnitType,
  MessageType,
} from "../game/Game";
import { manhattanDistFN, TileRef } from "../game/GameMap";
import { SAMMissileExecution } from "./SAMMissileExecution";
import { PseudoRandom } from "../PseudoRandom";

export class SAMLauncherExecution implements Execution {
  private player: Player;
  private mg: Game;
  private post: Unit;
  private active: boolean = true;

  private target: Unit = null;

  private searchRangeRadius = 75;

  private lastMissileAttack = 0;

  private pseudoRandom: PseudoRandom;

  constructor(
    private ownerId: PlayerID,
    private tile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (!mg.hasPlayer(this.ownerId)) {
      console.warn(`SAMLauncherExecution: owner ${this.ownerId} not found`);
      this.active = false;
      return;
    }
    this.player = mg.player(this.ownerId);
  }

  tick(ticks: number): void {
    if (this.post == null) {
      const spawnTile = this.player.canBuild(UnitType.SAMLauncher, this.tile);
      if (spawnTile == false) {
        consolex.warn("cannot build SAM Launcher");
        this.active = false;
        return;
      }
      this.post = this.player.buildUnit(UnitType.SAMLauncher, 0, spawnTile);
    }
    if (!this.post.isActive()) {
      this.active = false;
      return;
    }

    if (this.player != this.post.owner()) {
      this.player = this.post.owner();
    }

    if (!this.pseudoRandom) {
      this.pseudoRandom = new PseudoRandom(this.post.id());
    }

    const nukes = this.mg
      .nearbyUnits(this.post.tile(), this.searchRangeRadius, [
        UnitType.AtomBomb,
        UnitType.HydrogenBomb,
      ])
      .filter(
        ({ unit }) =>
          unit.owner() !== this.player && !this.player.isFriendly(unit.owner()),
      );

    this.target =
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
      })[0]?.unit ?? null;

    const cooldown =
      this.lastMissileAttack != 0 &&
      this.mg.ticks() - this.lastMissileAttack <=
        this.mg.config().samCooldown();

    if (this.post.isSamCooldown() && !cooldown) {
      this.post.setSamCooldown(false);
    }

    if (
      this.target &&
      !this.post.isSamCooldown() &&
      !this.target.targetedBySAM()
    ) {
      this.lastMissileAttack = this.mg.ticks();
      this.post.setSamCooldown(true);
      const random = this.pseudoRandom.next();
      const hit = random < this.mg.config().samHittingChance();

      this.lastMissileAttack = this.mg.ticks();
      if (!hit) {
        this.mg.displayMessage(
          `Missile failed to intercept ${this.target.type()}`,
          MessageType.ERROR,
          this.post.owner().id(),
        );
      } else {
        this.target.setTargetedBySAM(true);
        this.mg.addExecution(
          new SAMMissileExecution(
            this.post.tile(),
            this.post.owner(),
            this.post,
            this.target,
          ),
        );
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
