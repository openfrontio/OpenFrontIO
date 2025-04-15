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
import { PathFindResultType } from "../pathfinding/AStar";
import { PathFinder } from "../pathfinding/PathFinding";
import { PseudoRandom } from "../PseudoRandom";
import { SAMMissileExecution } from "./SAMMissileExecution";
import { ShellExecution } from "./ShellExecution";

export class SAMWarshipExecution implements Execution {
  private random: PseudoRandom;

  private player: Player;
  private active: boolean = true;
  private SAMWarship: Unit = null;
  private mg: Game = null;

  private warship_target: Unit = null;
  private SAM_target: Unit = null;
  private pseudoRandom: PseudoRandom;
  private pathfinder: PathFinder;

  private patrolTile: TileRef;

  // TODO: put in config
  private searchRange = 100;

  private shellAttackRate = 5;
  private lastShellAttack = 0;

  private alreadySentShell = new Set<Unit>();

  constructor(
    private playerID: PlayerID,
    private patrolCenterTile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this.playerID)) {
      console.log(`SAMWarshipExecution: player ${this.playerID} not found`);
      this.active = false;
      return;
    }
    this.pathfinder = PathFinder.Mini(mg, 5000, false);
    this.player = mg.player(this.playerID);
    this.mg = mg;
    this.patrolTile = this.patrolCenterTile;
    this.random = new PseudoRandom(mg.ticks());
  }

  goToMoveTarget(target: TileRef): boolean {
    const result = this.pathfinder.nextTile(this.SAMWarship.tile(), target);
    switch (result.type) {
      case PathFindResultType.Completed:
        this.SAMWarship.setMoveTarget(null);
        return;
      case PathFindResultType.NextTile:
        this.SAMWarship.move(result.tile);
        break;
      case PathFindResultType.Pending:
        break;
      case PathFindResultType.PathNotFound:
        consolex.log(`path not found to target`);
        break;
    }
  }

  private shoot() {
    if (this.mg.ticks() - this.lastShellAttack > this.shellAttackRate) {
      this.lastShellAttack = this.mg.ticks();
      this.mg.addExecution(
        new ShellExecution(
          this.SAMWarship.tile(),
          this.SAMWarship.owner(),
          this.SAMWarship,
          this.warship_target,
        ),
      );
      if (!this.warship_target.hasHealth()) {
        this.alreadySentShell.add(this.warship_target);
        this.warship_target = null;
        return;
      }
    }
  }

  private patrol() {
    this.SAMWarship.setWarshipTarget(this.warship_target);
    if (this.warship_target == null) {
      const result = this.pathfinder.nextTile(
        this.SAMWarship.tile(),
        this.patrolTile,
      );
      switch (result.type) {
        case PathFindResultType.Completed:
          this.patrolTile = this.randomTile();
          break;
        case PathFindResultType.NextTile:
          this.SAMWarship.move(result.tile);
          break;
        case PathFindResultType.Pending:
          return;
        case PathFindResultType.PathNotFound:
          consolex.log(`path not found to patrol tile`);
          this.patrolTile = this.randomTile();
          break;
      }
    }
  }

  private handleWarshipTargeting(): void {
    const hasPort = this.player.units(UnitType.Port).length > 0;

    const ships = this.mg
      .nearbyUnits(this.SAMWarship.tile(), 130, [
        UnitType.TransportShip,
        UnitType.Warship,
        UnitType.TradeShip,
        UnitType.SAMWarship,
        UnitType.NuclearWarship,
      ])
      .filter(
        ({ unit }) =>
          unit.owner() !== this.player &&
          unit !== this.SAMWarship &&
          !unit.owner().isFriendly(this.player) &&
          !this.alreadySentShell.has(unit) &&
          (unit.type() !== UnitType.TradeShip || hasPort) &&
          (unit.type() !== UnitType.TradeShip ||
            unit.dstPort()?.owner() !== this.player),
      );

    this.warship_target =
      ships.sort((a, b) => {
        const priority = (unit: Unit): number => {
          if (
            [
              UnitType.Warship,
              UnitType.NuclearWarship,
              UnitType.SAMWarship,
            ].includes(unit.type())
          )
            return 0;
          if (unit.type() === UnitType.TransportShip) return 1;
          return 2;
        };

        const aScore = priority(a.unit);
        const bScore = priority(b.unit);

        if (aScore !== bScore) return aScore - bScore;
        return a.distSquared - b.distSquared;
      })[0]?.unit ?? null;
  }

  private handleSAMTargeting(): void {
    if (!this.pseudoRandom) {
      this.pseudoRandom = new PseudoRandom(this.SAMWarship.id());
    }

    const nukes = this.mg
      .nearbyUnits(this.SAMWarship.tile(), this.searchRange, [
        UnitType.AtomBomb,
        UnitType.HydrogenBomb,
      ])
      .filter(
        ({ unit }) =>
          unit.owner() !== this.player && !this.player.isFriendly(unit.owner()),
      );

    this.SAM_target =
      nukes.sort((a, b) => {
        if (
          a.unit.type() === UnitType.HydrogenBomb &&
          b.unit.type() !== UnitType.HydrogenBomb
        )
          return -1;
        if (
          a.unit.type() !== UnitType.HydrogenBomb &&
          b.unit.type() === UnitType.HydrogenBomb
        )
          return 1;
        return a.distSquared - b.distSquared;
      })[0]?.unit ?? null;
  }

  tick(ticks: number): void {
    // If not built yet, try spawning the SAM warship
    if (!this.SAMWarship) {
      const spawn = this.player.canBuild(UnitType.SAMWarship, this.patrolTile);
      if (!spawn) {
        this.active = false;
        return;
      }
      this.SAMWarship = this.player.buildUnit(UnitType.SAMWarship, 0, spawn, {
        cooldownDuration: this.mg.config().SAMCooldown(),
      });
      return;
    }

    // If unit destroyed
    if (!this.SAMWarship.isActive()) {
      this.active = false;
      return;
    }

    // Reset invalid targets
    if (this.warship_target && !this.warship_target.isActive()) {
      this.warship_target = null;
    }
    if (this.warship_target?.owner() === this.player) {
      this.warship_target = null;
    }

    if (this.SAM_target && !this.SAM_target.isActive()) {
      this.SAM_target = null;
    }
    if (this.SAM_target?.owner() === this.player) {
      this.SAM_target = null;
    }

    this.handleWarshipTargeting();
    this.handleSAMTargeting();

    if (this.SAMWarship.moveTarget()) {
      this.goToMoveTarget(this.SAMWarship.moveTarget());
    } else {
      this.patrol();
    }

    if (
      this.warship_target &&
      this.warship_target.type() !== UnitType.TradeShip
    ) {
      this.shoot();
    }

    if (
      this.SAMWarship.isCooldown() &&
      this.SAMWarship.ticksLeftInCooldown(this.mg.config().SAMCooldown()) == 0
    ) {
      this.SAMWarship.setCooldown(false);
    }

    if (
      this.SAM_target &&
      !this.SAMWarship.isCooldown() &&
      !this.SAM_target.targetedBySAM()
    ) {
      this.SAMWarship.setCooldown(true);
      let hit = true;
      if (this.SAM_target.type() != UnitType.AtomBomb) {
        hit = this.pseudoRandom.next() < this.mg.config().samHittingChance();
      }
      if (!hit) {
        this.mg.displayMessage(
          `Missile failed to intercept ${this.SAM_target.type()}`,
          MessageType.ERROR,
          this.SAMWarship.owner().id(),
        );
      } else {
        this.SAM_target.setTargetedBySAM(true);
        this.mg.addExecution(
          new SAMMissileExecution(
            this.SAMWarship.tile(),
            this.SAMWarship.owner(),
            this.SAMWarship,
            this.SAM_target,
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

  randomTile(): TileRef {
    while (true) {
      const x =
        this.mg.x(this.patrolCenterTile) +
        this.random.nextInt(-this.searchRange / 2, this.searchRange / 2);
      const y =
        this.mg.y(this.patrolCenterTile) +
        this.random.nextInt(-this.searchRange / 2, this.searchRange / 2);
      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }
      const tile = this.mg.ref(x, y);
      if (!this.mg.isOcean(tile)) {
        continue;
      }
      return tile;
    }
  }
}
