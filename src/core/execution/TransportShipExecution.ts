import {
  Execution,
  Game,
  MessageType,
  Player,
  PlayerID,
  TerraNullius,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { targetTransportTile } from "../game/TransportShipUtils";
import { PathFindResultType } from "../pathfinding/AStar";
import { PathFinder } from "../pathfinding/PathFinding";
import { AttackExecution } from "./AttackExecution";

export class TransportShipExecution implements Execution {
  private lastMove: number;

  // TODO: make this configurable
  private ticksPerMove = 1;

  private active = true;

  private mg: Game;
  private target: Player | TerraNullius;

  // TODO make private
  public path: TileRef[];
  private dst: TileRef | null;

  private boat: Unit;

  private pathFinder: PathFinder;
  private totalPathLength: number | null = null; // Store the total A* path length when computed
  private pathComputed: boolean = false; // Track if A* path has been computed
  private fallbackTicks: number = 0; // Counter for fallback estimation
  private journeyStartTick: number | null = null; // Track when the journey started
  private lastPathUpdateTick: number | null = null; // Track when we last updated the path estimate

  constructor(
    private attacker: Player,
    private targetID: PlayerID | null,
    private ref: TileRef,
    private startTroops: number,
    private src: TileRef | null,
  ) {}

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number) {
    if (this.targetID !== null && !mg.hasPlayer(this.targetID)) {
      console.warn(`TransportShipExecution: target ${this.targetID} not found`);
      this.active = false;
      return;
    }
    if (!mg.isValidRef(this.ref)) {
      console.warn(`TransportShipExecution: ref ${this.ref} not valid`);
      this.active = false;
      return;
    }
    if (this.src !== null && !mg.isValidRef(this.src)) {
      console.warn(`TransportShipExecution: src ${this.src} not valid`);
      this.active = false;
      return;
    }

    this.lastMove = ticks;
    this.mg = mg;
    this.pathFinder = PathFinder.Mini(mg, 10_000, true, 100);

    if (
      this.attacker.unitCount(UnitType.TransportShip) >=
      mg.config().boatMaxNumber()
    ) {
      mg.displayMessage(
        `No boats available, max ${mg.config().boatMaxNumber()}`,
        MessageType.ATTACK_FAILED,
        this.attacker.id(),
      );
      this.active = false;
      return;
    }

    if (
      this.targetID === null ||
      this.targetID === this.mg.terraNullius().id()
    ) {
      this.target = mg.terraNullius();
    } else {
      this.target = mg.player(this.targetID);
    }

    this.startTroops ??= this.mg
      .config()
      .boatAttackAmount(this.attacker, this.target);

    this.startTroops = Math.min(this.startTroops, this.attacker.troops());

    this.dst = targetTransportTile(this.mg, this.ref);
    if (this.dst === null) {
      console.warn(
        `${this.attacker} cannot send ship to ${this.target}, cannot find attack tile`,
      );
      this.active = false;
      return;
    }

    const closestTileSrc = this.attacker.canBuild(
      UnitType.TransportShip,
      this.dst,
    );
    if (closestTileSrc === false) {
      console.warn(`can't build transport ship`);
      this.active = false;
      return;
    }

    if (this.src === null) {
      // Only update the src if it's not already set
      // because we assume that the src is set to the best spawn tile
      this.src = closestTileSrc;
    } else {
      if (
        this.mg.owner(this.src) !== this.attacker ||
        !this.mg.isShore(this.src)
      ) {
        console.warn(
          `src is not a shore tile or not owned by: ${this.attacker.name()}`,
        );
        this.src = closestTileSrc;
      }
    }

    this.boat = this.attacker.buildUnit(UnitType.TransportShip, this.src, {
      troops: this.startTroops,
    });

    // Don't set any estimated arrival tick initially - wait for A* path to complete

    // Notify the target player about the incoming naval invasion
    if (this.targetID && this.targetID !== mg.terraNullius().id()) {
      mg.displayIncomingUnit(
        this.boat.id(),
        // TODO TranslateText
        `Naval invasion incoming from ${this.attacker.displayName()}`,
        MessageType.NAVAL_INVASION_INBOUND,
        this.targetID,
      );
    }

    // Record stats
    this.mg
      .stats()
      .boatSendTroops(this.attacker, this.target, this.boat.troops());
  }

  tick(ticks: number) {
    if (this.dst === null) {
      this.active = false;
      return;
    }
    if (!this.active) {
      return;
    }
    if (!this.boat.isActive()) {
      this.active = false;
      return;
    }

    // Only calculate estimated arrival tick if A* path has been computed
    if (this.pathComputed) {
      // Periodically update the path estimate every 30 seconds (300 ticks) for better accuracy
      if (this.lastPathUpdateTick && ticks - this.lastPathUpdateTick >= 300) {
        const remainingPathLength = this.pathFinder.getPathLength();
        if (remainingPathLength > 0) {
          // Calculate how many tiles we've traveled since journey start
          const ticksTraveled = ticks - this.journeyStartTick!;
          const newTotalPathLength = remainingPathLength + ticksTraveled;
          this.totalPathLength = newTotalPathLength;
          this.lastPathUpdateTick = ticks;
        }
      }

      this.updateEstimatedArrivalTick(ticks);
    } else {
      // Fallback: if A* path is taking too long, use simple estimation
      // Use a simple counter instead of trying to access createdAt on Unit
      if (!this.fallbackTicks) {
        this.fallbackTicks = 0;
      }
      this.fallbackTicks++;

      if (this.fallbackTicks === 100) {
        // After 10 seconds, fall back to simple estimation (only once)
        this.useFallbackEstimation(ticks);
        this.pathComputed = true; // Mark as computed to prevent further fallback calls
      }
    }

    if (ticks - this.lastMove < this.ticksPerMove) {
      return;
    }
    this.lastMove = ticks;

    if (this.boat.retreating()) {
      this.dst = this.src!; // src is guaranteed to be set at this point
    }

    const result = this.pathFinder.nextTile(this.boat.tile(), this.dst);

    // Store the total path length when A* path is first completed
    // We need to detect completion when we get NextTile after Pending, but we need to account
    // for the fact that the pathfinder has already consumed some tiles
    if (result.type === PathFindResultType.NextTile && !this.pathComputed) {
      // Get the current remaining path length from the pathfinder
      const remainingPathLength = this.pathFinder.getPathLength();

      if (remainingPathLength > 0) {
        // The pathfinder has already consumed 1 tile (the current one), so add it back
        this.totalPathLength = remainingPathLength + 1;
        this.pathComputed = true;
        this.journeyStartTick = ticks; // Record when the journey started
        this.lastPathUpdateTick = ticks; // Record when we last updated the path

        // Now calculate the initial estimate
        this.updateEstimatedArrivalTick(ticks);
      } else {
        this.useFallbackEstimation(ticks);
        this.pathComputed = true;
      }
    }

    switch (result.type) {
      case PathFindResultType.Completed:
        if (this.mg.owner(this.dst) === this.attacker) {
          this.attacker.addTroops(this.boat.troops());
          this.boat.delete(false);
          this.active = false;

          // Record stats
          this.mg
            .stats()
            .boatArriveTroops(this.attacker, this.target, this.boat.troops());
          return;
        }
        this.attacker.conquer(this.dst);
        if (this.target.isPlayer() && this.attacker.isFriendly(this.target)) {
          this.attacker.addTroops(this.boat.troops());
        } else {
          this.mg.addExecution(
            new AttackExecution(
              this.boat.troops(),
              this.attacker,
              this.targetID,
              this.dst,
              false,
            ),
          );
        }
        this.boat.delete(false);
        this.active = false;

        // Record stats
        this.mg
          .stats()
          .boatArriveTroops(this.attacker, this.target, this.boat.troops());
        return;
      case PathFindResultType.NextTile:
        this.boat.move(result.node);
        break;
      case PathFindResultType.Pending:
        break;
      case PathFindResultType.PathNotFound:
        // TODO: add to poisoned port list
        console.warn(`path not found to dst`);
        this.attacker.addTroops(this.boat.troops());
        this.boat.delete(false);
        this.active = false;
        return;
    }
  }

  owner(): Player {
    return this.attacker;
  }

  isActive(): boolean {
    return this.active;
  }

  private updateEstimatedArrivalTick(currentTick: number): void {
    if (this.dst === null) {
      return;
    }

    // Only calculate if A* path has been computed
    if (!this.pathComputed || this.totalPathLength === null) {
      // Don't set any estimate while path is being calculated
      return;
    }

    // Calculate how many ticks have passed since we started the journey
    const ticksTraveled = currentTick - (this.journeyStartTick ?? currentTick);

    // Estimate remaining time based on total path length minus time already traveled
    const remainingTiles = Math.max(0, this.totalPathLength - ticksTraveled);
    const estimatedArrivalTick = currentTick + remainingTiles;

    // Store the estimated arrival tick on the boat
    if (this.boat.setEstimatedArrivalTick) {
      this.boat.setEstimatedArrivalTick(estimatedArrivalTick);
    }
  }

  private useFallbackEstimation(currentTick: number): void {
    if (this.dst === null || this.src === null) {
      return;
    }

    // Try to get the current path length from the pathfinder as fallback
    const currentPathLength = this.pathFinder.getPathLength();
    if (currentPathLength > 0) {
      this.totalPathLength = currentPathLength;
      this.journeyStartTick = currentTick;
      this.lastPathUpdateTick = currentTick;
    } else {
      // If no A* path available, wait for it to complete rather than using inaccurate distance estimates
      return; // Don't set any estimate, keep showing "Calculating..."
    }

    const estimatedArrivalTick = currentTick + this.totalPathLength;

    // Store the estimated arrival tick on the boat
    if (this.boat.setEstimatedArrivalTick) {
      this.boat.setEstimatedArrivalTick(estimatedArrivalTick);
    }
  }
}
