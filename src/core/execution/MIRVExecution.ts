import {
  Execution,
  Game,
  MessageType,
  Player,
  TerraNullius,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { UniversalPathFinding } from "../pathfinding/PathFinder";
import { ParabolaUniversalPathFinder } from "../pathfinding/PathFinder.Parabola";
import { PathStatus } from "../pathfinding/types";
import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";
import { NukeExecution } from "./NukeExecution";

export class MirvExecution implements Execution {
  private active = true;

  private mg: Game;

  private nuke: Unit | null = null;

  private range = 1500;
  private rangeSquared = this.range * this.range;
  private minimumSpread = 55;
  private warheadCount = 350;

  private baseX: number;
  private baseY: number;

  private random: PseudoRandom;

  private pathFinder: ParabolaUniversalPathFinder;
  private fullPath: TileRef[] = [];
  private pathIndex = 0;

  private targetPlayer: Player | TerraNullius;

  private separateDst: TileRef;
  private spawnTile: TileRef;

  private speed: number = -1;

  private stagedTargets: TileRef[] = [];
  private warheadsSpawned = false;

  constructor(
    private player: Player,
    private dst: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.random = new PseudoRandom(mg.ticks() + simpleHash(this.player.id()));
    this.mg = mg;
    this.targetPlayer = this.mg.owner(this.dst);
    this.speed = this.mg.config().nukeSpeed(UnitType.MIRV);
    this.pathFinder = UniversalPathFinding.Parabola(mg, {
      increment: this.speed,
    });
    this.baseX = this.mg.x(this.dst);
    this.baseY = this.mg.y(this.dst);
    this.stagedTargets = [this.dst];

    // Betrayal on launch
    if (this.targetPlayer.isPlayer()) {
      const alliance = this.player.allianceWith(this.targetPlayer);
      if (alliance !== null) {
        this.player.breakAlliance(alliance);
      }
      if (this.targetPlayer !== this.player) {
        this.targetPlayer.updateRelation(this.player, -100);
        this.player.updateRelation(this.targetPlayer, -100);
      }
    }
  }

  tick(ticks: number): void {
    if (this.nuke === null) {
      const spawn = this.player.canBuild(UnitType.MIRV, this.dst);
      if (spawn === false) {
        console.warn(`cannot build MIRV`);
        this.active = false;
        return;
      }
      this.spawnTile = spawn;
      this.nuke = this.player.buildUnit(UnitType.MIRV, spawn, {
        targetTile: this.dst,
      });
      this.mg.stats().bombLaunch(this.player, this.targetPlayer, UnitType.MIRV);
      const x = Math.floor((this.baseX + this.mg.x(this.nuke.tile())) / 2);
      const y = Math.max(0, this.baseY - 500) + 50;
      this.separateDst = this.mg.ref(x, y);

      let result = this.pathFinder.next(
        this.spawnTile,
        this.separateDst,
        this.speed,
      );
      while (result.status === PathStatus.NEXT) {
        this.fullPath.push(result.node);
        result = this.pathFinder.next(
          this.spawnTile,
          this.separateDst,
          this.speed,
        );
      }

      this.mg.displayIncomingUnit(
        this.nuke.id(),
        // TODO TranslateText
        `⚠️⚠️⚠️ ${this.player.displayName()} - MIRV INBOUND ⚠️⚠️⚠️`,
        MessageType.MIRV_INBOUND,
        this.targetPlayer.id(),
      );

      // after sending a nuke set the missilesilo on cooldown
      const silo = this.player
        .units(UnitType.MissileSilo)
        .find((silo) => silo.tile() === spawn);
      if (silo) {
        silo.launch();
      }
    }

    const remainingTicks = this.fullPath.length - this.pathIndex;

    // Stagger destination finding across ticks 20 down to 11 before separation
    if (remainingTicks <= 20 && remainingTicks > 10) {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (this.stagedTargets.length >= this.warheadCount) break;

        const target = this.tryGenerateTarget(this.stagedTargets);
        if (target) this.stagedTargets.push(target);
      }
    }

    // At <= 10 ticks before separation, re-validate tile ownership, finalize targets, sort, and instantiate NukeExecutions for SAM detection
    if (remainingTicks <= 10 && !this.warheadsSpawned) {
      this.warheadsSpawned = true;
      // Compensate missed precomputing targets if remainingTicks started <15
      const extraAttempts = (10 - remainingTicks) * 50;
      this.finalizeDestinations(500 + extraAttempts);
      this.spawnWarheadsWithWait();
    }

    if (this.pathIndex < this.fullPath.length) {
      this.nuke.move(this.fullPath[this.pathIndex++]);
    } else {
      this.separate();
      this.active = false;
      // Record stats
      this.mg.stats().bombLand(this.player, this.targetPlayer, UnitType.MIRV);
    }
  }

  private finalizeDestinations(additionalAttempts = 500): void {
    // Re-check target tile ownership at tick 10
    this.stagedTargets = this.stagedTargets.filter(
      (tile) => tile === this.dst || this.mg.owner(tile) === this.targetPlayer,
    );

    // Top-up loop using specified attempt budget if targets were lost or not yet filled
    for (let attempt = 0; attempt < additionalAttempts; attempt++) {
      if (this.stagedTargets.length >= this.warheadCount) break;
      const target = this.tryGenerateTarget(this.stagedTargets);
      if (target) this.stagedTargets.push(target);
    }

    // Sort in place
    this.stagedTargets.sort(
      (a, b) =>
        this.mg.manhattanDist(b, this.dst) - this.mg.manhattanDist(a, this.dst),
    );
  }

  private spawnWarheadsWithWait(): void {
    if (this.nuke === null) return;

    const warheadSpeed = this.mg.config().nukeSpeed(UnitType.MIRVWarhead);
    for (const [i, dst] of this.stagedTargets.entries()) {
      let speedOffset = 4;
      if (i < 70) speedOffset = 0;
      else if (i < 140) speedOffset = 1;
      else if (i < 210) speedOffset = 2;
      else if (i < 280) speedOffset = 3;
      this.mg.addExecution(
        new NukeExecution(
          UnitType.MIRVWarhead,
          this.player,
          dst,
          this.separateDst,
          // order of extra speed assign does not matter, they all spawn at once.
          warheadSpeed + speedOffset,
          10 + this.random.nextInt(0, 15),
        ),
      );
    }
  }

  private separate() {
    if (this.nuke === null) {
      throw new Error("uninitialized");
    }

    this.nuke.delete(false);
  }

  private tryGenerateTarget(taken: TileRef[]): TileRef | undefined {
    for (let attempt = 0; attempt < 100; attempt++) {
      const r1 = this.random.next();
      const r2 = (r1 * 15485863) % 1;

      const x = Math.round(r1 * this.range * 2 - this.range + this.baseX);
      const y = Math.round(r2 * this.range * 2 - this.range + this.baseY);

      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }

      const tile = this.mg.ref(x, y);

      if (!this.mg.isLand(tile)) {
        continue;
      }

      if ((x - this.baseX) ** 2 + (y - this.baseY) ** 2 > this.rangeSquared) {
        continue;
      }

      if (this.mg.owner(tile) !== this.targetPlayer) {
        continue;
      }

      if (this.isOverlapping(x, y, taken)) {
        continue;
      }

      return tile;
    }
  }

  private isOverlapping(x: number, y: number, taken: TileRef[]): boolean {
    for (const existingTile of taken) {
      const existingTileX = this.mg.x(existingTile);
      const existingTileY = this.mg.y(existingTile);
      const manhattanDistance =
        Math.abs(x - existingTileX) + Math.abs(y - existingTileY);

      if (manhattanDistance < this.minimumSpread) {
        return true;
      }
    }

    return false;
  }

  owner(): Player {
    return this.player;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
