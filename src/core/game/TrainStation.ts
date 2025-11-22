import { TrainExecution } from "../execution/TrainExecution";
import { GraphAdapter } from "../pathfinding/SerialAStar";
import { PseudoRandom } from "../PseudoRandom";
import { Game, Gold, Player, Unit, UnitType } from "./Game";
import { TileRef } from "./GameMap";
import { GameUpdateType, RailTile, RailType } from "./GameUpdates";
import { Railroad } from "./Railroad";

/**
 * Simple station lookup by tile ID for routing
 */
class StationLookup {
  private static stations = new Map<TileRef, TrainStation>();

  static register(station: TrainStation): void {
    this.stations.set(station.tile(), station);
  }

  static getStation(tile: TileRef): TrainStation | null {
    return this.stations.get(tile) ?? null;
  }

  static unregister(station: TrainStation): void {
    this.stations.delete(station.tile());
  }
}

/**
 * Lightweight routing entry using station IDs for memory efficiency
 */
export interface RoutingEntry {
  destinationId: number;
  nextHopId: number;
  hopCount: number;
  sequenceNumber: number;
  lastUpdate: number;
}

/**
 * Legacy interface for backward compatibility (deprecated)
 */
export interface RoutingEntryFull {
  destination: TrainStation;
  nextHop: TrainStation;
  hopCount: number;
  sequenceNumber: number;
  lastUpdate: number;
}

/**
 * Station traffic data (train counts, legacy heat field kept for stats only).
 * Routing decisions now use passenger demand instead of heat.
 */
export interface StationTraffic {
  trainCount: number; // Current number of trains at station
  heat: number; // Legacy congestion heat (no longer used for routing)
  lastHeatUpdate: number;
}

/**
 * Handle train stops at various station types
 */
interface TrainStopHandler {
  onStop(mg: Game, station: TrainStation, trainExecution: TrainExecution): void;
}

/**
 * All stop handlers share the same logic for the time being
 * Behavior to be defined
 */
class CityStopHandler implements TrainStopHandler {
  onStop(
    mg: Game,
    station: TrainStation,
    trainExecution: TrainExecution,
  ): void {
    const stationOwner = station.unit.owner();
    const trainOwner = trainExecution.owner();
    const relation = rel(trainOwner, stationOwner);
    const perLevelMax = mg.config().trainGold(relation);
    const level = station.unit.level();
    const maxGoldForThisTrain = perLevelMax * BigInt(level);

    const payout = station.consumePassengerPool(maxGoldForThisTrain);
    if (payout === 0n) {
      return;
    }

    // Share revenue with the station owner if it's not the current player
    if (trainOwner !== stationOwner) {
      stationOwner.addGold(payout, station.tile());
    }
    trainOwner.addGold(payout, station.tile());
  }
}

class PortStopHandler implements TrainStopHandler {
  constructor(private random: PseudoRandom) {}
  onStop(
    mg: Game,
    station: TrainStation,
    trainExecution: TrainExecution,
  ): void {
    const stationOwner = station.unit.owner();
    const trainOwner = trainExecution.owner();
    const relation = rel(trainOwner, stationOwner);
    const perLevelMax = mg.config().trainGold(relation);
    const level = station.unit.level();
    const maxGoldForThisTrain = perLevelMax * BigInt(level);

    const payout = station.consumePassengerPool(maxGoldForThisTrain);
    if (payout === 0n) {
      return;
    }

    // Train owner always gets the payout
    trainOwner.addGold(payout, station.tile());
    // Share revenue with the station owner if it's not the current player
    if (trainOwner !== stationOwner) {
      stationOwner.addGold(payout, station.tile());
    }
  }
}

class FactoryStopHandler implements TrainStopHandler {
  onStop(
    mg: Game,
    station: TrainStation,
    trainExecution: TrainExecution,
  ): void {}
}

export function createTrainStopHandlers(
  random: PseudoRandom,
): Partial<Record<UnitType, TrainStopHandler>> {
  return {
    [UnitType.City]: new CityStopHandler(),
    [UnitType.Port]: new PortStopHandler(random),
    [UnitType.Factory]: new FactoryStopHandler(),
  };
}

export class TrainStation {
  private readonly stopHandlers: Partial<Record<UnitType, TrainStopHandler>> =
    {};
  private random: PseudoRandom;
  private cluster: Cluster | null;
  private railroads: Set<Railroad> = new Set();
  // Quick lookup from neighboring station to connecting railroad
  private railroadByNeighbor: Map<TrainStation, Railroad> = new Map();
  // Batman routing properties - now using IDs for memory efficiency
  private routingTable: Map<number, RoutingEntry> = new Map();
  private sequenceNumber: number = 0;
  private originatorInterval: number = 1000; // ticks between broadcasts (increased 10x)
  private lastOriginatorBroadcast: number = 0;
  private routesChanged: boolean = false;
  private changedRoutes: Set<TrainStation> = new Set();

  private readonly maxHops: number = 20;
  private readonly routeStaleThreshold: number = 500; // ticks
  private readonly trainSearchRadius = 1; // Search up to x hops away for optimal routes through neighbors
  // Disabling broadcasts turns routing into local-only mode!
  // Implications:
  // - Stations only know routes their own trains discovered
  // - No network-wide knowledge sharing (via boradcast)
  // - Trains get stuck in loops more easily
  // - System becomes more like individual A* pathfinding

  private readonly enableBroadcasts: boolean = false; // Enable/disable BATMAN broadcast protocol

  // Lazy cleanup optimization
  private cleanupIndex: number = 0;
  private readonly routesToCheckPerTick = 3; // Check only 3 routes per tick

  // Local greedy routing properties
  private traffic: StationTraffic;
  private readonly stationDemandSensitivity: number = 0.1; // How strongly passenger demand boosts scores
  private readonly heatDecayInterval: number = 60; // How often heat decays (ticks)
  private readonly heatDecayFactor: number = 1 - 0.1; // How much heat decays per time (0.95 = 5% decay)
  // Softer, faster-decaying recency penalties now that profit-based routing discourages loops:
  // - Immediate revisit gets at most ~40% penalty
  // - Penalty shrinks quickly for older visits
  private readonly recencyDecayFactor: number = 1 - 0.1; // 0.9
  private readonly maxRecencyPenalty: number = 0.4; // 40% max penalty for immediate revisits

  private readonly randomChoiceProbability: number = 0.1; // Probability of making random choice instead of best (0.1 = 10%)

  // Approximate train speed used for routing heuristics (tiles per tick).
  // Keep this in sync with TrainExecution.speed.
  private readonly approxTrainSpeedTilesPerTick: number = 2;
  // Normalize fare (which is in gold units) into roughly the same scale as demand scores.
  private readonly fareNormalizationFactor: number = 1000;

  // Pre-computed decay factors for performance (avoid Math.pow in hot path)
  private readonly recencyDecayPowers: number[];

  // 0–1 scalar representing how "full" the station is with paying passengers.
  private passengerFullness: number = 1;
  // Last tick at which we updated passengerFullness.
  private lastPassengerUpdateTick: number;

  constructor(
    private mg: Game,
    public unit: Unit,
  ) {
    this.stopHandlers = createTrainStopHandlers(new PseudoRandom(mg.ticks()));
    this.random = new PseudoRandom(mg.ticks() + this.tile());

    // Register station for lookup
    StationLookup.register(this);

    // Initialize traffic tracking
    this.traffic = {
      trainCount: 0,
      heat: 0,
      lastHeatUpdate: mg.ticks(),
    };

    // Initialize self-route using tile as ID
    const stationTile = this.tile();
    this.routingTable.set(stationTile, {
      destinationId: stationTile,
      nextHopId: stationTile,
      hopCount: 0,
      sequenceNumber: this.sequenceNumber,
      lastUpdate: mg.ticks(),
    });
    this.changedRoutes.add(this);

    // Pre-compute recency decay factors for performance
    // Size matches TrainExecution.recentMemorySize (50) to avoid wasted space
    this.recencyDecayPowers = new Array(50); // max hops, fixme
    this.recencyDecayPowers[0] = 1.0; // stationsAgo - 1 = 0: full penalty
    for (let i = 1; i < this.recencyDecayPowers.length; i++) {
      this.recencyDecayPowers[i] =
        this.recencyDecayPowers[i - 1] * this.recencyDecayFactor;
    }

    // Initialize passenger demand tracking
    this.passengerFullness = 1;
    this.lastPassengerUpdateTick = mg.ticks();
  }

  tradeAvailable(otherPlayer: Player): boolean {
    const player = this.unit.owner();
    return otherPlayer === player || player.canTrade(otherPlayer);
  }

  clearRailroads() {
    this.railroads.clear();
    this.railroadByNeighbor.clear();
  }

  addRailroad(railRoad: Railroad) {
    this.railroads.add(railRoad);
    this.routesChanged = true; // Network topology changed

    // Determine neighboring station and maintain quick lookup
    const neighbor = railRoad.from === this ? railRoad.to : railRoad.from;
    if (neighbor) {
      this.railroadByNeighbor.set(neighbor, railRoad);
    }
  }

  removeRailroad(railRoad: Railroad) {
    this.railroads.delete(railRoad);
    const neighbor = railRoad.from === this ? railRoad.to : railRoad.from;
    if (neighbor) {
      this.railroadByNeighbor.delete(neighbor);
    }
    this.routesChanged = true; // Network topology changed
  }

  removeNeighboringRails(station: TrainStation) {
    const toRemove = [...this.railroads].find(
      (r) => r.from === station || r.to === station,
    );
    if (toRemove) {
      const railTiles: RailTile[] = toRemove.tiles.map((tile) => ({
        tile,
        railType: RailType.VERTICAL,
      }));
      this.mg.addUpdate({
        type: GameUpdateType.RailroadEvent,
        isActive: false,
        railTiles,
      });
      this.removeRailroad(toRemove);
    }
  }

  neighbors(): TrainStation[] {
    const neighbors: TrainStation[] = [];
    for (const r of this.railroads) {
      if (r.from !== this) {
        neighbors.push(r.from);
      } else {
        neighbors.push(r.to);
      }
    }
    return neighbors;
  }

  tile(): TileRef {
    return this.unit.tile();
  }

  isActive(): boolean {
    return this.unit.isActive();
  }

  getRailroads(): Set<Railroad> {
    return this.railroads;
  }

  getRailroadTo(station: TrainStation): Railroad | null {
    return this.railroadByNeighbor.get(station) ?? null;
  }

  setCluster(cluster: Cluster | null) {
    this.cluster = cluster;
  }

  getCluster(): Cluster | null {
    return this.cluster;
  }

  // ===== BATMAN ROUTING METHODS =====

  /**
   * Get the next hop toward a destination using routing table
   */
  getNextHop(destination: TrainStation): TrainStation | null {
    const destTile = destination.tile();
    const route = this.routingTable.get(destTile);

    if (route && route.hopCount <= this.maxHops) {
      const timeSinceUpdate = this.mg.ticks() - route.lastUpdate;
      if (timeSinceUpdate <= this.routeStaleThreshold) {
        return StationLookup.getStation(route.nextHopId);
      }
    }

    // No valid route - routes will be learned organically as trains explore
    return null;
  }

  /**
   * Broadcast originator message with changed routes only
   */
  broadcastOriginatorMessage(): void {
    this.sequenceNumber++;
    this.cleanupStaleRoutes();

    // Create a map of only changed routes using tile IDs
    const changedRoutesMap = new Map<number, RoutingEntry>();
    for (const dest of this.changedRoutes) {
      const destTile = dest.tile();
      const route = this.routingTable.get(destTile);
      if (route) {
        changedRoutesMap.set(destTile, route);
      }
    }

    // Clear changed routes after broadcasting
    this.changedRoutes.clear();

    // Send only changed routes to all neighbors
    for (const neighbor of this.neighbors()) {
      neighbor.receiveOriginatorMessage(
        this,
        changedRoutesMap,
        this.sequenceNumber,
      );
    }
  }

  /**
   * Receive and process originator message from another station
   */
  receiveOriginatorMessage(
    originator: TrainStation,
    originatorTable: Map<number, RoutingEntry>,
    originatorSeq: number,
  ): void {
    const currentTime = this.mg.ticks();
    let routesWereUpdated = false;

    // Get originator tile
    const originatorTile = originator.tile();

    // Only process if this is a newer sequence number than what we have for originator
    const existingSeq =
      this.routingTable.get(originatorTile)?.sequenceNumber ?? 0;
    if (originatorSeq <= existingSeq) {
      return; // Stale message
    }

    // Update route to originator itself
    this.routingTable.set(originatorTile, {
      destinationId: originatorTile,
      nextHopId: originatorTile, // Direct neighbor
      hopCount: 1,
      sequenceNumber: originatorSeq,
      lastUpdate: currentTime,
    });
    this.changedRoutes.add(originator);
    routesWereUpdated = true;

    // Process each route from originator
    for (const [destId, route] of originatorTable) {
      const newHopCount = route.hopCount + 1;

      // Skip if hop count would be too high
      if (newHopCount > this.maxHops) continue;

      const existingRoute = this.routingTable.get(destId);

      // Update if: no existing route, better hop count, or same hop count but newer sequence
      const shouldUpdate =
        !existingRoute ||
        newHopCount < existingRoute.hopCount ||
        (newHopCount === existingRoute.hopCount &&
          originatorSeq > existingRoute.sequenceNumber);

      if (shouldUpdate) {
        this.routingTable.set(destId, {
          destinationId: destId,
          nextHopId: originatorTile, // Next hop is the station we received this from
          hopCount: newHopCount,
          sequenceNumber: originatorSeq,
          lastUpdate: currentTime,
        });

        // Mark destination station as changed
        const destStation = StationLookup.getStation(destId);
        if (destStation) {
          this.changedRoutes.add(destStation);
        }
        routesWereUpdated = true;
      }
    }

    // If routes were updated, we should eventually broadcast our changes
    if (routesWereUpdated) {
      this.routesChanged = true;
    }
  }

  /**
   * Clean up stale routes - lazy implementation for scalability
   * Only checks a few routes per tick instead of all routes
   */
  private cleanupStaleRoutes(): void {
    const currentTime = this.mg.ticks();

    // Convert map to array for indexed access
    const routeEntries = Array.from(this.routingTable.entries());

    if (routeEntries.length === 0) {
      this.cleanupIndex = 0;
      return;
    }

    // Check only a few routes per tick (round-robin)
    const routesChecked = Math.min(
      this.routesToCheckPerTick,
      routeEntries.length,
    );

    for (let i = 0; i < routesChecked; i++) {
      const index = (this.cleanupIndex + i) % routeEntries.length;
      const [destId, route] = routeEntries[index];

      if (currentTime - route.lastUpdate > this.routeStaleThreshold) {
        this.routingTable.delete(destId);
        // Mark destination station as changed for potential rebroadcast
        const destStation = StationLookup.getStation(destId);
        if (destStation) {
          this.changedRoutes.add(destStation);
        }
      }
    }

    // Update index for next cleanup cycle
    this.cleanupIndex =
      (this.cleanupIndex + routesChecked) % routeEntries.length;
  }

  /**
   * Periodic tick for routing maintenance - event-driven broadcasting
   */
  tick(): void {
    // Update traffic metrics
    this.updateTraffic();

    const timeSinceLastBroadcast =
      this.mg.ticks() - this.lastOriginatorBroadcast;

    // Broadcast if routes changed OR if it's been too long since last broadcast

    if (
      this.enableBroadcasts &&
      (this.routesChanged || timeSinceLastBroadcast >= this.originatorInterval)
    ) {
      this.broadcastOriginatorMessage();
      this.routesChanged = false; // Reset the flag after broadcasting
      this.lastOriginatorBroadcast = this.mg.ticks();
    }
  }

  // ===== LOCAL GREEDY ROUTING METHODS =====

  /**
   * Update traffic when a train arrives
   */
  onTrainArrival(trainExecution: TrainExecution): void {
    this.traffic.trainCount++;

    // Increase station heat (unbounded)
    this.traffic.heat += 0.1;
    this.traffic.lastHeatUpdate = this.mg.ticks();
  }

  /**
   * Update traffic when a train departs
   */
  onTrainDeparture(trainExecution: TrainExecution): void {
    this.traffic.trainCount = Math.max(0, this.traffic.trainCount - 1);
  }

  /**
   * Roughly estimate the gold this train owner can expect from visiting a station,
   * using the same config values as the real payout (but without mutating state).
   *
   * Real payout at a stop is:
   *   perLevelMax(rel) * level * passengerFullness  (capped by the pool)
   *
   * We approximate that as:
   *   expectedProfit ≈ perLevelMax(rel) * (level * passengerFullness)
   *                  = perLevelMax(rel) * demandScore
   */
  private estimateExpectedProfitForStation(
    trainOwner: Player,
    station: TrainStation,
  ): number {
    const stationOwner = station.unit.owner();
    const relationship = rel(trainOwner, stationOwner);
    const perLevelMax = this.mg.config().trainGold(relationship); // Gold (BigInt)

    const demandScore = station.getPassengerDemandScore(); // ≈ level * fullness (0..level)

    // Convert to number for scoring; we only care about relative ordering.
    const basePerLevel = Number(perLevelMax);
    if (!Number.isFinite(basePerLevel) || basePerLevel <= 0) {
      return 0;
    }

    return basePerLevel * demandScore;
  }

  /**
   * Calculate edge score for local greedy routing with graduated recency penalties.
   * Uses an approximate "expected gold per tick" signal:
   *
   *   score ≈ expectedProfit(trainOwner, neighbor) / (fare + travelTimeCost)
   */
  private calculateEdgeScore(
    neighbor: TrainStation,
    stationsAgo: number, // -1 = never visited, 1 = immediate previous, 2 = 2 ago, etc.
    trainOwner: Player,
  ): number {
    const railroad = this.getRailroadTo(neighbor);
    if (!railroad) {
      return -Infinity;
    }

    const fare = Number(railroad.getFare());
    if (!Number.isFinite(fare) || fare <= 0) {
      return -Infinity;
    }

    const lengthTiles = railroad.getLength();
    const travelTimeTicks =
      lengthTiles > 0 ? lengthTiles / this.approxTrainSpeedTilesPerTick : 1;

    // Translate time into an approximate gold-cost so that long detours
    // are less attractive even when fare is low.
    const timeCostPerTick = 500; // tuning knob: "opportunity cost" of a tick
    const travelTimeCost = timeCostPerTick * travelTimeTicks;

    const expectedProfit = this.estimateExpectedProfitForStation(
      trainOwner,
      neighbor,
    );

    if (expectedProfit <= 0) {
      return -Infinity;
    }

    const effectiveCost = fare + travelTimeCost;
    if (effectiveCost <= 0) {
      return expectedProfit;
    }

    // Base score: approximate gold per unit of (fare + time cost).
    let score = expectedProfit / effectiveCost;

    // Apply graduated recency penalty based on stations ago
    if (stationsAgo > 0) {
      const exponent = stationsAgo - 1;
      const decayFactor =
        exponent < this.recencyDecayPowers.length
          ? this.recencyDecayPowers[exponent]
          : Math.pow(this.recencyDecayFactor, exponent);
      const penaltyStrength = decayFactor * this.maxRecencyPenalty;
      const recencyPenalty = 1.0 - penaltyStrength;
      score *= recencyPenalty;
    }

    // Ensure unvisited stations get a minimum exploration score
    // This prevents unknown stations from being ignored forever
    if (stationsAgo < 0 && score <= 0) {
      score = 0.2; // Small positive score to encourage exploration
    }

    return score;
  }

  /**
   * Calculate how many stations ago a station was visited
   */
  private getStationsAgo(
    station: TrainStation,
    recentStations: TrainStation[],
  ): number {
    const index = recentStations.lastIndexOf(station);
    if (index === -1) return -1; // Never visited in recent memory

    // Distance from end: 0 = current, 1 = immediate previous, 2 = 2 ago, etc.
    return recentStations.length - 1 - index;
  }

  /**
   * Choose next station using hybrid routing: prioritize known routes, fall back to greedy routing
   */
  chooseNextStation(
    destination: TrainStation,
    recentStations: TrainStation[],
    trainOwner: Player,
  ): TrainStation | null {
    const neighbors = this.neighbors();

    // First check: Pure exploration mode - if randomChoiceProbability triggers, pick completely random neighbor
    if (
      this.random.next() < this.randomChoiceProbability &&
      neighbors.length > 0
    ) {
      const randomIndex = this.random.nextInt(0, neighbors.length);
      return neighbors[randomIndex];
    }

    // Main routing logic: Check known routes (local + distributed when enabled)
    const nextHop = this.findBestRouteTo(destination, neighbors);
    if (nextHop) {
      // With some probability, still explore instead of following known route
      if (this.random.next() >= this.randomChoiceProbability) {
        return nextHop;
      }
      // Otherwise, fall through to greedy routing
    }

    // Fallback: Local greedy routing for exploration/unknown routes
    return this.chooseGreedyNeighbor(neighbors, recentStations, trainOwner);
  }

  /**
   * Find the best known route to destination, considering both local and distributed knowledge
   */
  private findBestRouteTo(
    destination: TrainStation,
    neighbors: TrainStation[],
  ): TrainStation | null {
    // Always check current station first
    const localNextHop = this.getNextHop(destination);
    if (localNextHop && neighbors.includes(localNextHop)) {
      return localNextHop;
    }

    // If distributed routing is enabled, check neighbors for better routes
    if (this.trainSearchRadius > 0) {
      const routeOptions: Array<{
        neighbor: TrainStation;
        totalHopCount: number;
      }> = [];

      for (const neighbor of neighbors) {
        const neighborRoute = neighbor.routingTable.get(destination.tile());
        if (neighborRoute && neighborRoute.hopCount <= this.trainSearchRadius) {
          const timeSinceUpdate = this.mg.ticks() - neighborRoute.lastUpdate;
          if (timeSinceUpdate <= this.routeStaleThreshold) {
            routeOptions.push({
              neighbor,
              totalHopCount: neighborRoute.hopCount + 1, // +1 for the hop to this neighbor
            });
          }
        }
      }

      if (routeOptions.length > 0) {
        // Sort by total hop count to find the shortest path
        routeOptions.sort((a, b) => a.totalHopCount - b.totalHopCount);
        return routeOptions[0].neighbor;
      }
    }

    return null;
  }

  /**
   * Choose neighbor using greedy routing based on profit/distance/traffic
   */
  private chooseGreedyNeighbor(
    neighbors: TrainStation[],
    recentStations: TrainStation[],
    trainOwner: Player,
  ): TrainStation | null {
    const validNeighbors: Array<{ station: TrainStation; score: number }> = [];

    for (const neighbor of neighbors) {
      const stationsAgo = this.getStationsAgo(neighbor, recentStations);
      const score = this.calculateEdgeScore(neighbor, stationsAgo, trainOwner);

      validNeighbors.push({ station: neighbor, score });
    }

    if (validNeighbors.length === 0) {
      return null;
    }

    // Pick the highest scoring neighbor
    let bestStation: TrainStation | null = null;
    let bestScore = -Infinity;

    for (const { station, score } of validNeighbors) {
      if (score > bestScore) {
        bestScore = score;
        bestStation = station;
      }
    }

    return bestStation;
  }

  /**
   * Clean up all references to this station when it's being removed
   */
  onStationRemoved(): void {
    const stationTile = this.tile();

    // Remove from StationLookup
    StationLookup.unregister(this);

    // Remove all routing table entries that reference this station
    for (const [destTile, route] of this.routingTable) {
      if (route.nextHopId === stationTile) {
        // This route goes through the station being removed
        this.routingTable.delete(destTile);
        this.changedRoutes.add(this); // Mark for rebroadcast if broadcasts enabled
      }
    }

    // Remove from changed routes
    this.changedRoutes.delete(this);

    // Clear routing table
    this.routingTable.clear();
  }

  /**
   * Clean up references to another station that has been removed
   */
  onOtherStationRemoved(removedStation: TrainStation): void {
    const removedTile = removedStation.tile();

    // Remove routing table entries that reference the removed station
    for (const [destTile, route] of this.routingTable) {
      if (route.nextHopId === removedTile) {
        // This route goes through the removed station
        this.routingTable.delete(destTile);
        this.changedRoutes.add(this); // Mark for rebroadcast if broadcasts enabled
      }
    }
  }

  /**
   * Get current traffic information
   */
  getTraffic(): StationTraffic {
    return { ...this.traffic };
  }

  /**
   * Update traffic metrics periodically
   */
  private updateTraffic(): void {
    const currentTime = this.mg.ticks();
    const timeSinceUpdate = currentTime - this.traffic.lastHeatUpdate;

    // Decay heat over time
    if (timeSinceUpdate > this.heatDecayInterval) {
      // Every 5 ticks
      this.traffic.heat *= this.heatDecayFactor;
      this.traffic.lastHeatUpdate = currentTime;
    }
  }

  /**
   * Lazily regenerate the passenger pool based on elapsed ticks.
   */
  private updatePassengerPool() {
    const now = this.mg.ticks();
    const dt = now - this.lastPassengerUpdateTick;
    if (dt <= 0) {
      return;
    }

    this.lastPassengerUpdateTick = now;

    const refillTime = this.mg.config().trainGoldRefillTime();
    if (refillTime <= 0) {
      this.passengerFullness = 1;
      return;
    }

    this.passengerFullness = Math.min(
      1,
      this.passengerFullness + dt / refillTime,
    );
  }

  /**
   * Public view for UI / analytics: how strong is demand right now?
   */
  getPassengerDemandScore(): number {
    this.updatePassengerPool();
    return this.passengerFullness * this.unit.level();
  }

  /**
   * Convert current passenger pool into an actual gold payout, then
   * deplete the pool proportionally.
   */
  consumePassengerPool(maxGoldForThisTrain: Gold): Gold {
    this.updatePassengerPool();

    const maxGoldNum = Number(maxGoldForThisTrain);
    if (maxGoldNum <= 0) {
      return 0n;
    }

    const payoutNum = Math.floor(maxGoldNum * this.passengerFullness);
    const payout = BigInt(payoutNum);

    if (payoutNum > 0) {
      this.passengerFullness -= payoutNum / maxGoldNum;
      if (this.passengerFullness < 0) {
        this.passengerFullness = 0;
      }
    }

    return payout;
  }

  onTrainStop(trainExecution: TrainExecution) {
    // Update traffic - train has arrived
    this.onTrainArrival(trainExecution);

    // Process journey information for organic route discovery
    this.processJourneyInformation(trainExecution);

    // Handle normal station behavior (gold rewards, etc.)
    const type = this.unit.type();
    const handler = this.stopHandlers[type];
    if (handler) {
      handler.onStop(this.mg, this, trainExecution);
    }
  }

  /**
   * Called when a train departs from this station
   */
  onTrainDepartureFromStation(trainExecution: TrainExecution): void {
    this.onTrainDeparture(trainExecution);
  }

  /**
   * Process journey information from a train to update routing tables organically
   */
  private processJourneyInformation(trainExecution: TrainExecution): void {
    const journeyInfo = trainExecution.shareJourneyInfo();

    // Only process journey information if the train has visited cities/ports in its recent journey
    const hasVisitedMeaningfulStations = journeyInfo.routeInformation.some(
      (routeInfo) => {
        const stationType = routeInfo.destination.unit.type();
        return stationType === UnitType.City || stationType === UnitType.Port;
      },
    );

    if (!hasVisitedMeaningfulStations) {
      // Train hasn't visited any cities/ports in its recent journey segment, skip journey processing
      return;
    }

    // Process routing information for each destination the train knows how to reach
    for (const routeInfo of journeyInfo.routeInformation) {
      const { destination, nextHop, distance } = routeInfo;

      // Store reverse route: if a train reached destination D via nextHop N,
      // then to get to D from here, go through N first
      if (nextHop && nextHop !== this) {
        this.updateReverseRouteFromJourney(destination, nextHop, distance);
      }
    }
  }

  /**
   * Update routing table with reverse route: when a train reached a destination,
   * store the destination, next hop to reach it, and distance
   **/
  private updateReverseRouteFromJourney(
    destination: TrainStation,
    nextHop: TrainStation,
    distance: number,
  ): void {
    if (destination === this) return; // Don't store route to self

    const currentTime = this.mg.ticks();
    const destinationTile = destination.tile();
    const existingRoute = this.routingTable.get(destinationTile);

    // Only update if this is a better route or we don't have one
    const shouldUpdate =
      !existingRoute ||
      distance < existingRoute.hopCount ||
      (distance === existingRoute.hopCount &&
        currentTime - existingRoute.lastUpdate > this.routeStaleThreshold / 2);

    if (shouldUpdate) {
      this.routingTable.set(destinationTile, {
        destinationId: destinationTile,
        nextHopId: nextHop.tile(),
        hopCount: distance,
        sequenceNumber: this.sequenceNumber,
        lastUpdate: currentTime,
      });

      this.changedRoutes.add(destination);
      this.routesChanged = true;
    }
  }
}
/**
 * Make the trainstation usable with A*
 */
export class TrainStationMapAdapter implements GraphAdapter<TrainStation> {
  constructor(private game: Game) {}

  neighbors(node: TrainStation): TrainStation[] {
    return node.neighbors();
  }

  cost(node: TrainStation): number {
    // Favor higher-demand stations slightly by reducing their traversal cost.
    const demand = node.getPassengerDemandScore(); // ~0..level
    const baseCost = 1;
    const alpha = 0.25; // tuning knob
    return baseCost / (1 + alpha * demand);
  }

  position(node: TrainStation): { x: number; y: number } {
    return { x: this.game.x(node.tile()), y: this.game.y(node.tile()) };
  }

  isTraversable(from: TrainStation, to: TrainStation): boolean {
    return true;
  }
}

/**
 * Cluster of connected stations
 */
export class Cluster {
  public stations: Set<TrainStation> = new Set();

  has(station: TrainStation) {
    return this.stations.has(station);
  }

  addStation(station: TrainStation) {
    this.stations.add(station);
    station.setCluster(this);
  }

  removeStation(station: TrainStation) {
    this.stations.delete(station);
  }

  addStations(stations: Set<TrainStation>) {
    for (const station of stations) {
      this.addStation(station);
    }
  }

  merge(other: Cluster) {
    for (const s of other.stations) {
      this.addStation(s);
    }
  }

  availableForTrade(player: Player): Set<TrainStation> {
    const tradingStations = new Set<TrainStation>();
    for (const station of this.stations) {
      if (
        (station.unit.type() === UnitType.City ||
          station.unit.type() === UnitType.Port) &&
        station.tradeAvailable(player)
      ) {
        tradingStations.add(station);
      }
    }
    return tradingStations;
  }

  size() {
    return this.stations.size;
  }

  clear() {
    this.stations.clear();
  }
}

function rel(
  player: Player,
  other: Player,
): "self" | "team" | "ally" | "other" {
  if (player === other) {
    return "self";
  }
  if (player.isOnSameTeam(other)) {
    return "team";
  }
  if (player.isAlliedWith(other)) {
    return "ally";
  }
  return "other";
}
