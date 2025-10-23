import { renderTroops } from "../../client/Utils";
import {
  Attack,
  Execution,
  Game,
  MessageType,
  Player,
  PlayerID,
  PlayerType,
  TerrainType,
  TerraNullius,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { FlatBinaryHeap } from "./utils/FlatBinaryHeap"; // adjust path if needed

const malusForRetreat = 25;
export class AttackExecution implements Execution {
  private active: boolean = true;
  private toConquer = new FlatBinaryHeap();

  private random = new PseudoRandom(123);

  private target: Player | TerraNullius;

  private mg: Game;

  private attack: Attack | null = null;

  private attackStartTick: number = 0;

  // Downscaled BFS distances (coarse grid only, for proximity bonus)
  private clickDistances: Map<TileRef, number> | null = null;

  // Downscale configuration
  private readonly DOWNSAMPLE_FACTOR = 10; // Sample every 10th tile

  // Performance telemetry for downscaled BFS
  private bfsInitTime: number = 0;
  private bfsCoarseGridSize: number = 0;
  private bfsDistanceLookups: number = 0;

  constructor(
    private startTroops: number | null = null,
    private _owner: Player,
    private _targetID: PlayerID | null,
    private sourceTile: TileRef | null = null,
    private removeTroops: boolean = true,
    private clickTile: TileRef | null = null,
  ) {}

  public targetID(): PlayerID | null {
    return this._targetID;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number) {
    if (!this.active) {
      return;
    }
    this.mg = mg;
    this.attackStartTick = ticks;

    if (this._targetID !== null && !mg.hasPlayer(this._targetID)) {
      console.warn(`target ${this._targetID} not found`);
      this.cleanupBFSDistances();
      this.active = false;
      return;
    }

    this.target =
      this._targetID === this.mg.terraNullius().id()
        ? mg.terraNullius()
        : mg.player(this._targetID);

    if (this._owner === this.target) {
      console.error(`Player ${this._owner} cannot attack itself`);
      this.cleanupBFSDistances();
      this.active = false;
      return;
    }

    // ALLIANCE CHECK — block attacks on friendly (ally or same team)
    if (this.target.isPlayer()) {
      const targetPlayer = this.target as Player;
      if (this._owner.isFriendly(targetPlayer)) {
        console.warn(
          `${this._owner.displayName()} cannot attack ${targetPlayer.displayName()} because they are friendly (allied or same team)`,
        );
        this.cleanupBFSDistances();
        this.active = false;
        return;
      }
    }

    if (this.target && this.target.isPlayer()) {
      const targetPlayer = this.target as Player;
      if (
        targetPlayer.type() !== PlayerType.Bot &&
        this._owner.type() !== PlayerType.Bot
      ) {
        // Don't let bots embargo since they can't trade anyway.
        targetPlayer.addEmbargo(this._owner, true);
        this.rejectIncomingAllianceRequests(targetPlayer);
      }
    }

    // Compute downscaled BFS distances for directed attack
    if (this.clickTile !== null) {
      // Validate click tile exists in map by checking if it has neighbors
      const neighbors = this.mg.neighbors(this.clickTile);
      if (neighbors.length === 0) {
        console.warn(
          `[DirectedAttack] Click tile has no neighbors, may be invalid`,
        );
      }

      // Performance: Measure downscaled BFS computation time
      const startTime = performance.now();

      // Build coarse grid (sample every Nth tile)
      const coarseGrid = this.buildCoarseGrid(this.DOWNSAMPLE_FACTOR);
      this.bfsCoarseGridSize = coarseGrid.size;

      // Compute BFS on coarse grid only
      this.clickDistances = this.computeDownscaledBFS(
        this.clickTile,
        coarseGrid,
        this.DOWNSAMPLE_FACTOR,
      );

      const endTime = performance.now();
      this.bfsInitTime = endTime - startTime;

      console.log(
        `[DirectedAttack] Downscaled BFS (${this.DOWNSAMPLE_FACTOR}x): computed ${this.clickDistances.size} coarse tiles in ${this.bfsInitTime.toFixed(2)}ms`,
      );
    }

    if (this.target.isPlayer()) {
      if (
        this.mg.config().numSpawnPhaseTurns() +
          this.mg.config().spawnImmunityDuration() >
        this.mg.ticks()
      ) {
        console.warn("cannot attack player during immunity phase");
        this.cleanupBFSDistances();
        this.active = false;
        return;
      }
    }

    this.startTroops ??= this.mg
      .config()
      .attackAmount(this._owner, this.target);
    if (this.removeTroops) {
      this.startTroops = Math.min(this._owner.troops(), this.startTroops);
      this._owner.removeTroops(this.startTroops);
    }
    this.attack = this._owner.createAttack(
      this.target,
      this.startTroops,
      this.sourceTile,
      new Set<TileRef>(),
    );

    if (this.sourceTile !== null) {
      this.addNeighbors(this.sourceTile);
    } else {
      this.refreshToConquer();
    }

    // Record stats
    this.mg.stats().attack(this._owner, this.target, this.startTroops);

    for (const incoming of this._owner.incomingAttacks()) {
      if (incoming.attacker() === this.target) {
        // Target has opposing attack, cancel them out
        if (incoming.troops() > this.attack.troops()) {
          incoming.setTroops(incoming.troops() - this.attack.troops());
          this.attack.delete();
          this.cleanupBFSDistances();
          this.active = false;
          return;
        } else {
          this.attack.setTroops(this.attack.troops() - incoming.troops());
          incoming.delete();
        }
      }
    }
    for (const outgoing of this._owner.outgoingAttacks()) {
      if (
        outgoing !== this.attack &&
        outgoing.target() === this.attack.target() &&
        // Boat attacks (sourceTile is not null) are not combined with other attacks
        this.attack.sourceTile() === null
      ) {
        this.attack.setTroops(this.attack.troops() + outgoing.troops());
        outgoing.delete();
      }
    }

    if (this.target.isPlayer()) {
      this.target.updateRelation(this._owner, -80);
    }
  }

  private refreshToConquer() {
    if (this.attack === null) {
      throw new Error("Attack not initialized");
    }

    this.toConquer.clear();
    this.attack.clearBorder();
    for (const tile of this._owner.borderTiles()) {
      this.addNeighbors(tile);
    }
  }

  private retreat(malusPercent = 0) {
    if (this.attack === null) {
      throw new Error("Attack not initialized");
    }

    const deaths = this.attack.troops() * (malusPercent / 100);
    if (deaths) {
      this.mg.displayMessage(
        `Attack cancelled, ${renderTroops(deaths)} soldiers killed during retreat.`,
        MessageType.ATTACK_CANCELLED,
        this._owner.id(),
      );
    }
    const survivors = this.attack.troops() - deaths;
    this._owner.addTroops(survivors);
    this.attack.delete();
    this.cleanupBFSDistances();
    this.active = false;

    // Not all retreats are canceled attacks
    if (this.attack.retreated()) {
      // Record stats
      this.mg.stats().attackCancel(this._owner, this.target, survivors);
    }
  }

  tick(ticks: number) {
    if (this.attack === null) {
      throw new Error("Attack not initialized");
    }
    let troopCount = this.attack.troops(); // cache troop count
    const targetIsPlayer = this.target.isPlayer(); // cache target type
    const targetPlayer = targetIsPlayer ? (this.target as Player) : null; // cache target player

    if (this.attack.retreated()) {
      if (targetIsPlayer) {
        this.retreat(malusForRetreat);
      } else {
        this.retreat();
      }
      this.cleanupBFSDistances();
      this.active = false;
      return;
    }

    if (this.attack.retreating()) {
      return;
    }

    if (!this.attack.isActive()) {
      this.cleanupBFSDistances();
      this.active = false;
      return;
    }

    if (targetPlayer && this._owner.isFriendly(targetPlayer)) {
      // In this case a new alliance was created AFTER the attack started.
      this.retreat();
      return;
    }

    let numTilesPerTick = this.mg
      .config()
      .attackTilesPerTick(
        troopCount,
        this._owner,
        this.target,
        this.attack.borderSize() + this.random.nextInt(0, 5),
      );

    while (numTilesPerTick > 0) {
      if (troopCount < 1) {
        this.attack.delete();
        this.cleanupBFSDistances();
        this.active = false;
        return;
      }

      if (this.toConquer.size() === 0) {
        this.refreshToConquer();
        this.retreat();
        return;
      }

      const [tileToConquer] = this.toConquer.dequeue();
      this.attack.removeBorderTile(tileToConquer);

      let onBorder = false;
      for (const n of this.mg.neighbors(tileToConquer)) {
        if (this.mg.owner(n) === this._owner) {
          onBorder = true;
          break;
        }
      }
      if (this.mg.owner(tileToConquer) !== this.target || !onBorder) {
        continue;
      }
      this.addNeighbors(tileToConquer);
      const { attackerTroopLoss, defenderTroopLoss, tilesPerTickUsed } = this.mg
        .config()
        .attackLogic(
          this.mg,
          troopCount,
          this._owner,
          this.target,
          tileToConquer,
        );
      numTilesPerTick -= tilesPerTickUsed;
      troopCount -= attackerTroopLoss;
      this.attack.setTroops(troopCount);
      if (targetPlayer) {
        targetPlayer.removeTroops(defenderTroopLoss);
      }
      this._owner.conquer(tileToConquer);
      this.handleDeadDefender();
    }
  }

  private rejectIncomingAllianceRequests(target: Player) {
    const request = this._owner
      .incomingAllianceRequests()
      .find((ar) => ar.requestor() === target);
    if (request !== undefined) {
      request.reject();
    }
  }

  /**
   * Builds a coarse grid by sampling every Nth tile in both x and y directions.
   * For a 2000x1000 map with downsample=10, this creates a 200x100 = 20,000 tile coarse grid.
   *
   * @param downsampleFactor Sample every Nth tile (default: 10)
   * @returns Set of coarse tile refs for fast O(1) lookup
   */
  private buildCoarseGrid(downsampleFactor: number): Set<TileRef> {
    const coarseTiles = new Set<TileRef>();
    const mapWidth = this.mg.width();
    const mapHeight = this.mg.height();

    // Sample tiles at grid points: (0,0), (10,0), (20,0), ... (0,10), (10,10), ...
    for (let y = 0; y < mapHeight; y += downsampleFactor) {
      for (let x = 0; x < mapWidth; x += downsampleFactor) {
        if (this.mg.isValidCoord(x, y)) {
          const tile = this.mg.ref(x, y);
          coarseTiles.add(tile);
        }
      }
    }

    return coarseTiles;
  }

  /**
   * Finds the nearest coarse grid tile to a given tile.
   * Rounds coordinates to the nearest grid point.
   *
   * @param tile The tile to find nearest coarse tile for
   * @param downsampleFactor The grid spacing
   * @returns Nearest coarse tile ref
   */
  private findNearestCoarseTile(
    tile: TileRef,
    downsampleFactor: number,
  ): TileRef {
    const x = this.mg.x(tile);
    const y = this.mg.y(tile);

    // Round to nearest grid point
    const coarseX = Math.round(x / downsampleFactor) * downsampleFactor;
    const coarseY = Math.round(y / downsampleFactor) * downsampleFactor;

    // Clamp to last coarse grid coordinate (not map bounds)
    const mapWidth = this.mg.width();
    const mapHeight = this.mg.height();
    const maxCoarseX =
      Math.floor((mapWidth - 1) / downsampleFactor) * downsampleFactor;
    const maxCoarseY =
      Math.floor((mapHeight - 1) / downsampleFactor) * downsampleFactor;
    const clampedX = Math.max(0, Math.min(maxCoarseX, coarseX));
    const clampedY = Math.max(0, Math.min(maxCoarseY, coarseY));

    return this.mg.ref(clampedX, clampedY);
  }

  /**
   * Computes BFS distances on a downscaled coarse grid.
   * Only traverses tiles that are in the coarse grid, resulting in ~100x fewer tiles processed.
   *
   * @param clickTile The tile that was clicked (start of BFS)
   * @param coarseGrid Set of tiles in the coarse grid
   * @param downsampleFactor Grid spacing for finding neighbors
   * @returns Map of coarse tile refs to their BFS distance from start
   */
  private computeDownscaledBFS(
    clickTile: TileRef,
    coarseGrid: Set<TileRef>,
    downsampleFactor: number,
  ): Map<TileRef, number> {
    const distances = new Map<TileRef, number>();

    // Find nearest coarse tile to click point as start
    const startTile = this.findNearestCoarseTile(clickTile, downsampleFactor);
    distances.set(startTile, 0);

    // BFS queue
    const queue: TileRef[] = [startTile];
    let head = 0;

    while (head < queue.length) {
      const current = queue[head++];
      const currentDist = distances.get(current)!;

      // Get coarse neighbors (tiles at ±downsampleFactor in each direction)
      const x = this.mg.x(current);
      const y = this.mg.y(current);
      const mapWidth = this.mg.width();
      const mapHeight = this.mg.height();

      const neighborOffsets = [
        [0, -downsampleFactor], // North
        [0, +downsampleFactor], // South
        [-downsampleFactor, 0], // West
        [+downsampleFactor, 0], // East
      ];

      for (const [dx, dy] of neighborOffsets) {
        const nx = x + dx;
        const ny = y + dy;

        if (nx >= 0 && nx < mapWidth && ny >= 0 && ny < mapHeight) {
          const neighbor = this.mg.ref(nx, ny);

          // Only process if it's in coarse grid and not visited
          if (coarseGrid.has(neighbor) && !distances.has(neighbor)) {
            distances.set(neighbor, currentDist + 1);
            queue.push(neighbor);
          }
        }
      }
    }

    return distances;
  }

  /**
   * Gets the downscaled BFS distance for any tile by looking up its nearest coarse grid tile.
   *
   * @param tile The tile to get distance for
   * @returns BFS distance in tiles, or null if not available
   */
  private getDownscaledDistance(tile: TileRef): number | null {
    if (this.clickDistances === null) {
      return null;
    }

    this.bfsDistanceLookups++;

    // Find nearest coarse tile
    const coarseTile = this.findNearestCoarseTile(tile, this.DOWNSAMPLE_FACTOR);

    // Return its distance
    return this.clickDistances.get(coarseTile) ?? null;
  }

  private addNeighbors(tile: TileRef) {
    if (this.attack === null) {
      throw new Error("Attack not initialized");
    }

    const tickNow = this.mg.ticks(); // cache tick

    for (const neighbor of this.mg.neighbors(tile)) {
      if (
        this.mg.isWater(neighbor) ||
        this.mg.owner(neighbor) !== this.target
      ) {
        continue;
      }
      this.attack.addBorderTile(neighbor);
      let numOwnedByMe = 0;
      for (const n of this.mg.neighbors(neighbor)) {
        if (this.mg.owner(n) === this._owner) {
          numOwnedByMe++;
        }
      }

      let mag = 0;
      switch (this.mg.terrainType(neighbor)) {
        case TerrainType.Plains:
          mag = 1;
          break;
        case TerrainType.Highland:
          mag = 1.5;
          break;
        case TerrainType.Mountain:
          mag = 2;
          break;
      }

      const defensibilityWeight =
        (this.random.nextInt(0, 7) + 10) * (1 - numOwnedByMe * 0.5 + mag / 2);

      let priority =
        defensibilityWeight + 0.2 * (tickNow - this.attackStartTick);

      if (this.clickTile !== null) {
        // Per-tile vector approach: each border tile calculates its own direction to click
        // This creates triangular convergence toward the clicked point
        const clickX = this.mg.x(this.clickTile);
        const clickY = this.mg.y(this.clickTile);
        const neighborX = this.mg.x(neighbor);
        const neighborY = this.mg.y(neighbor);

        // Use the current border tile directly (tile parameter)
        // Since neighbor comes from this.mg.neighbors(tile), tile is already adjacent to neighbor
        const borderX = this.mg.x(tile);
        const borderY = this.mg.y(tile);

        // Vector from border tile -> click point
        const dirX = clickX - borderX;
        const dirY = clickY - borderY;
        const dirMag = Math.sqrt(dirX * dirX + dirY * dirY);

        if (dirMag > 0.001) {
          // Normalize direction vector
          const dirNormX = dirX / dirMag;
          const dirNormY = dirY / dirMag;

          // Vector from border tile -> neighbor
          const toNeighborX = neighborX - borderX;
          const toNeighborY = neighborY - borderY;
          const toNeighborMag = Math.sqrt(
            toNeighborX * toNeighborX + toNeighborY * toNeighborY,
          );

          if (toNeighborMag > 0.001) {
            // Normalize neighbor vector
            const toNeighborNormX = toNeighborX / toNeighborMag;
            const toNeighborNormY = toNeighborY / toNeighborMag;

            // Dot product measures alignment (-1 to 1)
            const dotProduct =
              dirNormX * toNeighborNormX + dirNormY * toNeighborNormY;

            // Apply direction bias with explicit exponential time decay
            // Calculate explicit exponential time decay
            // Direction influence fades naturally as attack progresses
            const timeSinceStart = tickNow - this.attackStartTick;
            const timeDecayConstant = this.mg.config().attackTimeDecay();
            const timeDecayFactor = Math.exp(
              -timeSinceStart / timeDecayConstant,
            );

            // Apply direction offset with time decay (additive approach)
            // (1.0 - dotProduct) gives 0.0 for perfect alignment, 2.0 for opposite
            const directionOffset =
              (1.0 - dotProduct) *
              this.mg.config().attackDirectionWeight() *
              timeDecayFactor;
            priority += directionOffset;

            // Optional: Add BFS-based proximity bonus (topological distance decay)
            // Tiles topologically closer to click point get additional priority boost
            const magnitudeWeight = this.mg.config().attackMagnitudeWeight();
            if (magnitudeWeight > 0) {
              // Get downscaled BFS distance (from coarse grid), fall back to Euclidean
              // Measure distance from neighbor (candidate tile) to click point
              let distance: number;
              const bfsDistance = this.getDownscaledDistance(neighbor); // neighbor = candidate to conquer
              if (bfsDistance !== null) {
                // Use downscaled BFS distance (topologically correct, ±5-10 tile accuracy)
                distance = bfsDistance;
              } else {
                // DISABLED: Euclidean fallback
                // With the clamping bug fixed, this should never happen for rectangular maps.
                // If this error occurs, it indicates either:
                // 1. Non-rectangular map with holes in coordinate space
                // 2. Future terrain-aware BFS creating disconnected regions
                // 3. A regression of the clamping bug
                console.error(
                  `[DirectedAttack] BFS distance is null for neighbor tile (${neighborX}, ${neighborY}). ` +
                    `This should never happen with the clamping fix. Using fallback.`,
                );

                // Fallback to Euclidean (kept for defensive programming)
                const neighborToClickX = clickX - neighborX;
                const neighborToClickY = clickY - neighborY;
                distance = Math.sqrt(
                  neighborToClickX * neighborToClickX +
                    neighborToClickY * neighborToClickY,
                );
              }

              // Apply exponential distance decay
              // Note: BFS distance is in tiles, Euclidean was in coordinate units
              // Adjust decay constant accordingly
              const distanceDecayConstant = this.mg
                .config()
                .attackDistanceDecayConstant();
              const proximityBonus =
                Math.exp(-distance / distanceDecayConstant) *
                magnitudeWeight *
                timeDecayFactor;
              priority -= proximityBonus; // Lower priority = better (min-heap)
            }
          }
        }
      }

      this.toConquer.enqueue(neighbor, priority);
    }
  }

  /**
   * Cleans up BFS distance map to free memory.
   * Call this when the attack ends/deactivates.
   */
  private cleanupBFSDistances() {
    if (this.clickDistances !== null) {
      // Log downscaled BFS telemetry before cleanup
      if (this.bfsCoarseGridSize > 0) {
        console.log(
          `[DirectedAttack] Downscaled Stats: ${this.bfsCoarseGridSize} coarse tiles, ` +
            `downsample=${this.DOWNSAMPLE_FACTOR}x, init=${this.bfsInitTime.toFixed(2)}ms, ` +
            `${this.bfsDistanceLookups} distance lookups`,
        );
      }

      this.clickDistances.clear();
      this.clickDistances = null;
    }
  }

  private handleDeadDefender() {
    if (!(this.target.isPlayer() && this.target.numTilesOwned() < 100)) return;

    this.mg.conquerPlayer(this._owner, this.target);

    for (let i = 0; i < 10; i++) {
      for (const tile of this.target.tiles()) {
        const borders = this.mg
          .neighbors(tile)
          .some((t) => this.mg.owner(t) === this._owner);
        if (borders) {
          this._owner.conquer(tile);
        } else {
          for (const neighbor of this.mg.neighbors(tile)) {
            const no = this.mg.owner(neighbor);
            if (no.isPlayer() && no !== this.target) {
              this.mg.player(no.id()).conquer(tile);
              break;
            }
          }
        }
      }
    }
  }

  owner(): Player {
    return this._owner;
  }

  isActive(): boolean {
    return this.active;
  }
}
