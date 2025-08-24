import {
  Execution,
  Game,
  isStructureType,
  MessageType,
  Player,
  TerraNullius,
  TrajectoryTile,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { ParabolaPathFinder } from "../pathfinding/PathFinding";
import { NukeType } from "../StatsSchemas";

const SPRITE_RADIUS = 16;

export class NukeExecution implements Execution {
  private active = true;
  private mg: Game | undefined;
  private nuke: Unit | null = null;
  private tilesToDestroyCache: Set<TileRef> | undefined;
  private pathFinder: ParabolaPathFinder | undefined;

  constructor(
    private readonly nukeType: NukeType,
    private readonly player: Player,
    private readonly dst: TileRef,
    private src?: TileRef | null,
    private speed = -1,
    private waitTicks = 0,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (this.speed === -1) {
      this.speed = this.mg.config().defaultNukeSpeed();
    }
    this.pathFinder = new ParabolaPathFinder(mg);
  }

  public target(): Player | TerraNullius {
    if (this.mg === undefined) throw new Error("Not initialized");
    return this.mg.owner(this.dst);
  }

  private tilesToDestroy(): Set<TileRef> {
    if (this.tilesToDestroyCache !== undefined) {
      return this.tilesToDestroyCache;
    }
    if (this.nuke === null) {
      throw new Error("Not initialized");
    }
    if (this.mg === undefined) throw new Error("Not initialized");
    const magnitude = this.mg.config().nukeMagnitudes(this.nuke.type());
    const rand = new PseudoRandom(this.mg.ticks());
    const inner2 = magnitude.inner * magnitude.inner;
    const outer2 = magnitude.outer * magnitude.outer;
    this.tilesToDestroyCache = this.mg.bfs(this.dst, (_, n: TileRef) => {
      const d2 = this.mg?.euclideanDistSquared(this.dst, n) ?? 0;
      return d2 <= outer2 && (d2 <= inner2 || rand.chance(2));
    });
    return this.tilesToDestroyCache;
  }

  private maybeBreakAlliances(toDestroy: Set<TileRef>) {
    if (this.mg === undefined) throw new Error("Not initialized");
    if (this.nuke === null) {
      throw new Error("Not initialized");
    }
    const attacked = new Map<Player, number>();
    for (const tile of toDestroy) {
      const owner = this.mg.owner(tile);
      if (owner.isPlayer()) {
        const prev = attacked.get(owner) ?? 0;
        attacked.set(owner, prev + 1);
      }
    }

    const threshold = this.mg.config().nukeAllianceBreakThreshold();
    for (const [other, tilesDestroyed] of attacked) {
      if (
        tilesDestroyed > threshold &&
        this.nuke.type() !== UnitType.MIRVWarhead
      ) {
        // Mirv warheads shouldn't break alliances
        const alliance = this.player.allianceWith(other);
        if (alliance !== null) {
          this.player.breakAlliance(alliance);
        }
        if (other !== this.player) {
          other.updateRelation(this.player, -100);
        }
      }
    }
  }

  tick(ticks: number): void {
    if (this.mg === undefined) throw new Error("Not initialized");
    if (this.pathFinder === undefined) throw new Error("Not initialized");
    if (this.nuke === null) {
      const spawn = this.src ?? this.player.canBuild(this.nukeType, this.dst);
      if (spawn === false) {
        console.warn("cannot build Nuke");
        this.active = false;
        return;
      }
      this.src = spawn;
      this.pathFinder.computeControlPoints(
        spawn,
        this.dst,
        this.speed,
        this.nukeType !== UnitType.MIRVWarhead,
      );
      this.nuke = this.player.buildUnit(this.nukeType, spawn, {
        targetTile: this.dst,
        trajectory: this.getTrajectory(this.dst),
      });
      this.maybeBreakAlliances(this.tilesToDestroy());
      if (this.mg.hasOwner(this.dst)) {
        const target = this.mg.owner(this.dst);
        if (!target.isPlayer()) {
          // Ignore terra nullius
        } else if (this.nukeType === UnitType.AtomBomb) {
          this.mg.displayIncomingUnit(
            this.nuke.id(),
            // TODO TranslateText
            `${this.player.name()} - atom bomb inbound`,
            MessageType.NUKE_INBOUND,
            target.id(),
          );
        } else if (this.nukeType === UnitType.HydrogenBomb) {
          this.mg.displayIncomingUnit(
            this.nuke.id(),
            // TODO TranslateText
            `${this.player.name()} - hydrogen bomb inbound`,
            MessageType.HYDROGEN_BOMB_INBOUND,
            target.id(),
          );
        }

        // Record stats
        this.mg.stats().bombLaunch(this.player, target, this.nukeType);
      }

      // after sending a nuke set the missilesilo on cooldown
      const silo = this.player
        .units(UnitType.MissileSilo)
        .find((silo) => silo.tile() === spawn);
      if (silo) {
        silo.launch();
      }
      return;
    }

    // make the nuke unactive if it was intercepted
    if (!this.nuke.isActive()) {
      console.log("Nuke destroyed before reaching target");
      this.active = false;
      return;
    }

    if (this.waitTicks > 0) {
      this.waitTicks--;
      return;
    }

    // Move to next tile
    const nextTile = this.pathFinder.nextTile(this.speed);
    if (nextTile === true) {
      this.detonate();
      return;
    } else {
      this.updateNukeTargetable();
      this.nuke.move(nextTile);
      // Update index so SAM can interpolate future position
      this.nuke.setTrajectoryIndex(this.pathFinder.currentIndex());
    }
  }

  public getNuke(): Unit | null {
    return this.nuke;
  }

  private getTrajectory(target: TileRef): TrajectoryTile[] {
    if (this.mg === undefined) throw new Error("Not initialized");
    if (this.pathFinder === undefined) throw new Error("Not initialized");
    const trajectoryTiles: TrajectoryTile[] = [];
    const targetRangeSquared =
      this.mg.config().defaultNukeTargetableRange() ** 2;
    const allTiles: TileRef[] = this.pathFinder.allTiles();
    for (const tile of allTiles) {
      const targetable = this.isTargetable(target, tile, targetRangeSquared);
      trajectoryTiles.push({
        targetable,
        tile,
      });
    }

    return trajectoryTiles;
  }

  private isTargetable(
    targetTile: TileRef,
    nukeTile: TileRef,
    targetRangeSquared: number,
  ): boolean {
    if (this.mg === undefined) throw new Error("Not initialized");
    return (
      this.mg.euclideanDistSquared(nukeTile, targetTile) < targetRangeSquared ||
      (this.src !== undefined &&
        this.src !== null &&
        this.mg.euclideanDistSquared(this.src, nukeTile) < targetRangeSquared)
    );
  }

  private updateNukeTargetable() {
    if (this.nuke === null || this.nuke.targetTile() === undefined) {
      return;
    }
    if (this.mg === undefined) throw new Error("Not initialized");
    const targetRangeSquared =
      this.mg.config().defaultNukeTargetableRange() ** 2;
    const targetTile = this.nuke.targetTile();
    if (targetTile === undefined) return;
    this.nuke.setTargetable(
      this.isTargetable(targetTile, this.nuke.tile(), targetRangeSquared),
    );
  }

  private detonate() {
    if (this.mg === undefined) throw new Error("Not initialized");
    if (this.nuke === null) {
      throw new Error("Not initialized");
    }

    const magnitude = this.mg.config().nukeMagnitudes(this.nuke.type());
    const toDestroy = this.tilesToDestroy();
    this.maybeBreakAlliances(toDestroy);

    const maxTroops = this.target().isPlayer()
      ? this.mg.config().maxTroops(this.target() as Player)
      : 1;

    for (const tile of toDestroy) {
      const owner = this.mg.owner(tile);
      if (owner.isPlayer()) {
        owner.relinquish(tile);
        owner.removeTroops(
          this.mg
            .config()
            .nukeDeathFactor(
              this.nukeType,
              owner.troops(),
              owner.numTilesOwned(),
              maxTroops,
            ),
        );
        owner.outgoingAttacks().forEach((attack) => {
          const deaths =
            this.mg
              ?.config()
              .nukeDeathFactor(
                this.nukeType,
                attack.troops(),
                owner.numTilesOwned(),
                maxTroops,
              ) ?? 0;
          attack.setTroops(attack.troops() - deaths);
        });
        owner.units(UnitType.TransportShip).forEach((attack) => {
          const deaths =
            this.mg
              ?.config()
              .nukeDeathFactor(
                this.nukeType,
                attack.troops(),
                owner.numTilesOwned(),
                maxTroops,
              ) ?? 0;
          attack.setTroops(attack.troops() - deaths);
        });
      }

      if (this.mg.isLand(tile)) {
        this.mg.setFallout(tile, true);
      }
    }

    const outer2 = magnitude.outer * magnitude.outer;
    for (const unit of this.mg.units()) {
      if (
        unit.type() !== UnitType.AtomBomb &&
        unit.type() !== UnitType.HydrogenBomb &&
        unit.type() !== UnitType.MIRVWarhead &&
        unit.type() !== UnitType.MIRV
      ) {
        if (this.mg.euclideanDistSquared(this.dst, unit.tile()) < outer2) {
          unit.delete(true, this.player);
        }
      }
    }

    this.redrawBuildings(magnitude.outer + SPRITE_RADIUS);
    this.active = false;
    this.nuke.setReachedTarget();
    this.nuke.delete(false);

    // Record stats
    this.mg
      .stats()
      .bombLand(this.player, this.target(), this.nuke.type() as NukeType);
  }

  private redrawBuildings(range: number) {
    if (this.mg === undefined) throw new Error("Not initialized");
    const rangeSquared = range * range;
    for (const unit of this.mg.units()) {
      if (isStructureType(unit.type())) {
        if (
          this.mg.euclideanDistSquared(this.dst, unit.tile()) < rangeSquared
        ) {
          unit.touch();
        }
      }
    }
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
