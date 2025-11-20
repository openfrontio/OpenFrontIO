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
const MIN_VECTOR_MAGNITUDE = 0.001;

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

  // Cached click tile coordinates (computed once per attack)
  private clickX: number = 0;
  private clickY: number = 0;

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
      // Validate click tile is within map bounds
      if (!this.mg.isValidRef(this.clickTile)) {
        console.warn(
          `[DirectedAttack] Invalid click tile reference: ${this.clickTile}, disabling directed attack`,
        );
        this.clickTile = null;
      } else {
        // Secondary check: warn if tile is isolated (has no neighbors)
        const neighbors = this.mg.neighbors(this.clickTile);
        if (neighbors.length === 0) {
          console.warn(
            `[DirectedAttack] Click tile is isolated (no neighbors), may affect directed attack`,
          );
        }

        // Cache click coordinates once per attack (performance optimization)
        this.clickX = this.mg.x(this.clickTile);
        this.clickY = this.mg.y(this.clickTile);

        // Performance: Measure downscaled BFS computation time
        const startTime = performance.now();

        // Build coarse grid via BFS from clicked tile (single pass)
        this.clickDistances = this.buildCoarseGrid(
          this.clickTile,
          this.mg.config().attackBFSDownsampleFactor(),
        );
        this.bfsCoarseGridSize = this.clickDistances.size;

        const endTime = performance.now();
        this.bfsInitTime = endTime - startTime;
      }
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
    if (this.removeTroops === false && this.sourceTile === null) {
      // startTroops are always added to attack troops at init but not always removed from owner troops
      // subtract startTroops from attack troops so we don't give back startTroops to owner that were never removed
      // boat attacks (sourceTile !== null) are the exception: troops were removed at departure and must be returned after attack still
      this.attack.setTroops(this.attack.troops() - (this.startTroops ?? 0));
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
   * Builds coarse grid via BFS from clicked tile through connected target-owned tiles.
   * Returns distance map directly - no separate adjacency graph needed.
   *
   * Excludes water tiles to ensure topologically correct distances.
   * Applies a maximum radius limit to all attacks to prevent performance issues
   * with large empires on huge maps.
   *
   * @param clickTile Starting point for BFS (where user clicked)
   * @param downsampleFactor Sample tiles at grid coordinates (multiples of N)
   * @returns Map of coarse tile refs to their BFS distance from click
   */
  private buildCoarseGrid(
    clickTile: TileRef,
    downsampleFactor: number,
  ): Map<TileRef, number> {
    const distances = new Map<TileRef, number>();
    const visited = new Set<TileRef>();
    const queue: Array<{ tile: TileRef; dist: number }> = [
      { tile: clickTile, dist: 0 },
    ];
    // Always use attack target, not clickTile owner
    // This ensures we traverse target's territory even if player clicks their own territory
    const targetOwner = this.target;

    // Apply BFS radius limit to all attacks (prevents performance issues with large empires)
    const maxRadius = this.mg.config().attackBFSMaxRadius();

    visited.add(clickTile);

    // Always include click tile in distances, regardless of grid alignment
    // This ensures accurate proximity calculation near the click point
    distances.set(clickTile, 0);

    let head = 0;
    while (head < queue.length) {
      const { tile, dist } = queue[head++];

      // Downsample: only keep tiles at grid coordinates
      const x = this.mg.x(tile);
      const y = this.mg.y(tile);
      if (x % downsampleFactor === 0 && y % downsampleFactor === 0) {
        distances.set(tile, dist);
      }

      // Stop expanding if we've reached max radius (after storing tile)
      if (dist >= maxRadius) continue;

      // Traverse neighbors with same owner (connected component only)
      for (const neighbor of this.mg.neighbors(tile)) {
        if (visited.has(neighbor)) continue;
        if (this.mg.owner(neighbor) !== targetOwner) continue;
        if (this.mg.isWater(neighbor)) continue;

        visited.add(neighbor);
        queue.push({ tile: neighbor, dist: dist + 1 });
      }
    }

    return distances;
  }

  /**
   * Calculates proximity bonus based on BFS distance from click point.
   * Returns negative value (bonus reduces priority in min-heap).
   *
   * @param neighbor The tile being evaluated for conquest
   * @param elapsedTicks Time since attack started (for decay factor)
   * @returns Proximity bonus (negative value, or 0 if not available)
   */
  private calculateProximityBonus(
    neighbor: TileRef,
    elapsedTicks: number,
  ): number {
    const magnitudeWeight = this.mg.config().attackMagnitudeWeight();
    if (magnitudeWeight <= 0) {
      return 0;
    }

    const bfsDistance = this.getDownscaledDistance(neighbor);
    if (bfsDistance === null) {
      return 0;
    }

    // Calculate time decay factor
    const timeDecayConstant = this.mg.config().attackTimeDecay();
    const timeDecayFactor = Math.exp(-elapsedTicks / timeDecayConstant);

    // Apply exponential distance decay
    const distanceDecayConstant = this.mg
      .config()
      .attackDistanceDecayConstant();
    const proximityBonus =
      Math.exp(-bfsDistance / distanceDecayConstant) *
      magnitudeWeight *
      timeDecayFactor;

    return -proximityBonus; // Negative because lower priority = better (min-heap)
  }

  /**
   * Calculates directional priority offset based on alignment with click point.
   * Returns 0 for tiles aligned toward the click, higher values for misaligned tiles.
   *
   * @param neighbor The tile being evaluated for conquest
   * @param border The current border tile (owned by attacker)
   * @param elapsedTicks Time since attack started (for decay factor)
   * @returns Priority offset (0-6 range, higher = lower priority)
   */
  private calculateDirectionOffset(
    neighbor: TileRef,
    border: TileRef,
    elapsedTicks: number,
  ): number {
    const neighborX = this.mg.x(neighbor);
    const neighborY = this.mg.y(neighbor);
    const borderX = this.mg.x(border);
    const borderY = this.mg.y(border);

    // Vector from border tile -> click point
    const dirX = this.clickX - borderX;
    const dirY = this.clickY - borderY;
    const dirMag = Math.sqrt(dirX * dirX + dirY * dirY);

    if (dirMag <= MIN_VECTOR_MAGNITUDE) {
      return 0;
    }

    // Normalize direction vector
    const dirNormX = dirX / dirMag;
    const dirNormY = dirY / dirMag;

    // Vector from border tile -> neighbor
    const toNeighborX = neighborX - borderX;
    const toNeighborY = neighborY - borderY;
    const toNeighborMag = Math.sqrt(
      toNeighborX * toNeighborX + toNeighborY * toNeighborY,
    );

    if (toNeighborMag <= MIN_VECTOR_MAGNITUDE) {
      return 0;
    }

    // Normalize neighbor vector
    const toNeighborNormX = toNeighborX / toNeighborMag;
    const toNeighborNormY = toNeighborY / toNeighborMag;

    // Dot product measures alignment (-1 to 1)
    const dotProduct = dirNormX * toNeighborNormX + dirNormY * toNeighborNormY;

    // Calculate exponential time decay for direction influence
    const timeDecayConstant = this.mg.config().attackTimeDecay();
    const timeDecayFactor = Math.exp(-elapsedTicks / timeDecayConstant);

    // (1.0 - dotProduct) gives 0.0 for perfect alignment, 2.0 for opposite
    return (
      (1.0 - dotProduct) *
      this.mg.config().attackDirectionWeight() *
      timeDecayFactor
    );
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
   * Gets the downscaled BFS distance for any tile by looking up its nearest coarse grid tile.
   * If the nearest coarse tile is missing (e.g., water), searches the 4 corners of the grid cell
   * for the nearest valid tile.
   *
   * @param tile The tile to get distance for
   * @returns BFS distance in tiles, or null if not available
   */
  private getDownscaledDistance(tile: TileRef): number | null {
    if (this.clickDistances === null) {
      return null;
    }

    this.bfsDistanceLookups++;

    const downsampleFactor = this.mg.config().attackBFSDownsampleFactor();

    // Fast path: try nearest coarse tile first (handles most cases)
    const nearestCoarse = this.findNearestCoarseTile(tile, downsampleFactor);
    const nearestDistance = this.clickDistances.get(nearestCoarse);
    if (nearestDistance !== undefined) {
      return nearestDistance;
    }

    // Fallback: nearest coarse tile is missing (likely water or disconnected region)
    // Search the 4 corners of the grid cell containing this tile
    const x = this.mg.x(tile);
    const y = this.mg.y(tile);
    const baseX = Math.floor(x / downsampleFactor) * downsampleFactor;
    const baseY = Math.floor(y / downsampleFactor) * downsampleFactor;

    // Calculate valid bounds for coarse grid coordinates (same logic as findNearestCoarseTile)
    const mapWidth = this.mg.width();
    const mapHeight = this.mg.height();
    const maxCoarseX =
      Math.floor((mapWidth - 1) / downsampleFactor) * downsampleFactor;
    const maxCoarseY =
      Math.floor((mapHeight - 1) / downsampleFactor) * downsampleFactor;

    // Generate candidates with bounds checking
    const candidates: Array<{ ref: number; x: number; y: number }> = [];
    for (const dx of [0, downsampleFactor]) {
      for (const dy of [0, downsampleFactor]) {
        const cx = baseX + dx;
        const cy = baseY + dy;

        // Only add candidate if within valid coarse grid bounds
        if (cx >= 0 && cx <= maxCoarseX && cy >= 0 && cy <= maxCoarseY) {
          candidates.push({ ref: this.mg.ref(cx, cy), x: cx, y: cy });
        }
      }
    }

    // Find the nearest candidate that exists in the distances map
    let bestDistance: number | null = null;
    let minDistSq = Infinity;

    for (const { ref, x: cx, y: cy } of candidates) {
      const dist = this.clickDistances.get(ref);
      if (dist !== undefined) {
        const dx = cx - x;
        const dy = cy - y;
        const distSq = dx * dx + dy * dy;

        if (distSq < minDistSq) {
          minDistSq = distSq;
          bestDistance = dist;
        }
      }
    }

    return bestDistance;
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

      // Wave front offset (linear growth)
      // Tiles discovered earlier get priority over tiles discovered later
      const elapsedTicks = tickNow - this.attackStartTick;
      let priority = defensibilityWeight + elapsedTicks;

      if (this.clickTile !== null) {
        // Per-tile vector approach: each border tile calculates its own direction to click
        // This creates triangular convergence toward the clicked point
        const directionOffset = this.calculateDirectionOffset(
          neighbor,
          tile,
          elapsedTicks,
        );
        priority += directionOffset;

        // Add BFS-based proximity bonus (topological distance decay)
        const proximityBonus = this.calculateProximityBonus(
          neighbor,
          elapsedTicks,
        );
        priority += proximityBonus;
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
