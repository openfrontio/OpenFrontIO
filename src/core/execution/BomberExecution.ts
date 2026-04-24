import {
  Execution,
  Game,
  MessageType,
  TrajectoryTile,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { AirPathFinder } from "../pathfinding/PathFinder.Air";

enum BomberPhase {
  Outbound,
  Returning,
}

export class BomberExecution implements Execution {
  private active = true;
  private mg: Game;
  private bomber: Unit | null = null;
  private phase: BomberPhase = BomberPhase.Outbound;
  private speed: number = 1;
  private trajectory: TileRef[] = [];
  private outboundIndex = 0;
  private returnPath: AirPathFinder | null = null;

  constructor(
    private airfield: Unit,
    private targetTile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.speed = mg.config().bomberSpeed();
  }

  tick(ticks: number): void {
    if (this.bomber === null) {
      this.spawnBomber();
      if (this.bomber === null) {
        this.active = false;
        return;
      }
      return;
    }

    if (!this.bomber.isActive()) {
      this.active = false;
      return;
    }

    for (let i = 0; i < this.speed; i++) {
      this.step();
      if (!this.active) return;
    }
  }

  private spawnBomber(): void {
    const owner = this.airfield.owner();
    const airfieldTile = this.airfield.tile();
    const air = new AirPathFinder(this.mg);
    const path = air.findPath(airfieldTile, this.targetTile) ?? [];
    if (path.length === 0) {
      this.active = false;
      return;
    }
    this.trajectory = path;
    this.outboundIndex = 0;

    const trajectoryTiles: TrajectoryTile[] = path.map((tile) => ({
      tile,
      targetable: true,
    }));

    this.bomber = owner.buildUnit(UnitType.Bomber, airfieldTile, {
      homeAirfield: this.airfield,
      targetTile: this.targetTile,
      trajectory: trajectoryTiles,
    });

    const targetOwner = this.mg.owner(this.targetTile);
    if (targetOwner.isPlayer()) {
      this.mg.displayIncomingUnit(
        this.bomber.id(),
        `${owner.displayName()} - bomber inbound`,
        MessageType.NUKE_INBOUND,
        targetOwner.id(),
      );
    }
  }

  private step(): void {
    if (this.bomber === null) return;
    if (this.phase === BomberPhase.Outbound) {
      this.outboundIndex++;
      if (this.outboundIndex >= this.trajectory.length) {
        this.detonate();
        this.phase = BomberPhase.Returning;
        this.bomber.setReachedTarget();
        this.returnPath = new AirPathFinder(this.mg);
        return;
      }
      this.bomber.move(this.trajectory[this.outboundIndex]);
      this.bomber.setTrajectoryIndex(this.outboundIndex);
      return;
    }

    // Returning phase
    const homeTile = this.airfield.isActive()
      ? this.airfield.tile()
      : this.findFallbackHome();
    if (homeTile === null) {
      this.bomber.delete(false);
      this.active = false;
      return;
    }
    if (this.bomber.tile() === homeTile) {
      this.bomber.delete(false);
      this.active = false;
      return;
    }
    this.returnPath ??= new AirPathFinder(this.mg);
    const path = this.returnPath.findPath(this.bomber.tile(), homeTile);
    if (path === null || path.length < 2) {
      this.bomber.delete(false);
      this.active = false;
      return;
    }
    this.bomber.move(path[1]);
  }

  private findFallbackHome(): TileRef | null {
    if (this.bomber === null) return null;
    const owner = this.bomber.owner();
    const alt = owner
      .units(UnitType.Airfield)
      .find((u) => u.isActive() && !u.isUnderConstruction());
    return alt ? alt.tile() : null;
  }

  private detonate(): void {
    if (this.bomber === null) return;
    const mg = this.mg;
    const mag = mg.config().bombMagnitude();
    const outerSq = mag.outer * mag.outer;
    const innerSq = mag.inner * mag.inner;
    const dst = this.targetTile;
    const owner = this.bomber.owner();

    const tiles = mg.bfs(
      dst,
      (_, n) => mg.euclideanDistSquared(dst, n) <= outerSq,
    );
    for (const t of tiles) {
      const tileOwner = mg.owner(t);
      if (tileOwner.isPlayer() && tileOwner !== owner) {
        if (mg.euclideanDistSquared(dst, t) <= innerSq) {
          tileOwner.relinquish(t);
        }
      }
    }

    for (const unit of mg.units()) {
      const t = unit.type();
      if (
        t === UnitType.AtomBomb ||
        t === UnitType.HydrogenBomb ||
        t === UnitType.MIRV ||
        t === UnitType.MIRVWarhead ||
        t === UnitType.SAMMissile ||
        t === UnitType.Bomber ||
        t === UnitType.Bomb
      ) {
        continue;
      }
      if (mg.euclideanDistSquared(dst, unit.tile()) < outerSq) {
        if (unit.owner() !== owner) unit.delete(true, owner);
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
