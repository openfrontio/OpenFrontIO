import { TrainExecution } from "../execution/TrainExecution";
import { GraphAdapter } from "../pathfinding/SerialAStar";
import { PseudoRandom } from "../PseudoRandom";
import { Game, Player, Unit, UnitType } from "./Game";
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
 * Edge metrics for local greedy routing
 */
export interface EdgeMetrics {
  toStation: TrainStation;
  baseDuration: number; // Base travel time/cost to this station
  distance: number; // Physical distance (affects duration)
  lastUpdated: number; // When metrics were last updated
}

/**
 * Station traffic and congestion data
 */
export interface StationTraffic {
  trainCount: number; // Current number of trains at station
  recentArrivals: number; // Trains arrived in last N ticks
  heat: number; // Congestion heat (0-1, decays over time)
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
    const goldBonus = mg.config().trainGold(rel(trainOwner, stationOwner));
    // Share revenue with the station owner if it's not the current player
    if (trainOwner !== stationOwner) {
      stationOwner.addGold(goldBonus, station.tile());
    }
    trainOwner.addGold(goldBonus, station.tile());
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
    const goldBonus = mg.config().trainGold(rel(trainOwner, stationOwner));

    trainOwner.addGold(goldBonus, station.tile());
    // Share revenue with the station owner if it's not the current player
    if (trainOwner !== stationOwner) {
      stationOwner.addGold(goldBonus, station.tile());
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

  // Batman routing properties - now using IDs for memory efficiency
  private routingTable: Map<number, RoutingEntry> = new Map();
  private sequenceNumber: number = 0;
  private originatorInterval: number = 1000; // ticks between broadcasts (increased 10x)
  private lastOriginatorBroadcast: number = 0;
  private routesChanged: boolean = false;
  private changedRoutes: Set<TrainStation> = new Set();
  private maxHops: number = 20;
  private routeStaleThreshold: number = 500; // ticks

  // Lazy cleanup optimization
  private cleanupIndex: number = 0;
  private readonly routesToCheckPerTick = 3; // Check only 3 routes per tick

  // Local greedy routing properties
  private edgeMetrics: Map<TrainStation, EdgeMetrics> = new Map();
  private traffic: StationTraffic;
  private profitSensitivity: number = 0.3; // How much profit-per-distance boosts scores
  private distanceSensitivity: number = 0.2; // How much distance increases duration penalties
  private stationHeatSensitivity: number = 0.4; // How much station heat reduces scores
  private recencyDecayFactor: number = 0.1; // Exponential decay rate for recency penalties
  private maxRecencyPenalty: number = 1; // Maximum penalty for immediate revisits
  // Disabling broadcasts turns routing into local-only mode!
  // Implications:
  // - Stations only know routes their own trains discovered
  // - No network-wide knowledge sharing (BATMAN protocol disabled)
  // - Trains get stuck in loops more easily
  // - Route discovery becomes slower and less efficient
  // - System becomes more like individual A* pathfinding
  // - Lower memory usage but higher train congestion
  private enableBroadcasts: boolean = false; // Enable/disable BATMAN broadcast protocol
  private randomChoiceProbability: number = 0.1; // Probability of making random choice instead of best (0.1 = 10%)

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
      recentArrivals: 0,
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
  }

  tradeAvailable(otherPlayer: Player): boolean {
    const player = this.unit.owner();
    return otherPlayer === player || player.canTrade(otherPlayer);
  }

  clearRailroads() {
    this.railroads.clear();
  }

  addRailroad(railRoad: Railroad) {
    this.railroads.add(railRoad);
    this.routesChanged = true; // Network topology changed

    // Initialize edge metrics for new connection
    const neighbor = railRoad.from === this ? railRoad.to : railRoad.from;
    if (neighbor && !this.edgeMetrics.has(neighbor)) {
      this.initializeEdgeMetrics(neighbor);
    }
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
      this.railroads.delete(toRemove);
      this.routesChanged = true; // Network topology changed
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
   * Initialize edge metrics for a neighboring station
   */
  private initializeEdgeMetrics(neighborStation: TrainStation): void {
    const distance = this.calculateDistance(neighborStation);
    const baseDuration = Math.max(1, Math.floor(distance / 2)); // Rough duration estimate

    this.edgeMetrics.set(neighborStation, {
      toStation: neighborStation,
      baseDuration,
      distance,
      lastUpdated: this.mg.ticks(),
    });
  }

  /**
   * Calculate physical distance to another station
   */
  private calculateDistance(other: TrainStation): number {
    const dx = Math.abs(this.mg.x(this.tile()) - this.mg.x(other.tile()));
    const dy = Math.abs(this.mg.y(this.tile()) - this.mg.y(other.tile()));
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Calculate actual profit for a train owner traveling to another station
   * Uses the game's actual trainGold configuration based on relationship
   */
  private calculateActualProfit(
    trainOwner: Player,
    other: TrainStation,
  ): number {
    const stationOwner = other.unit.owner();
    const relationship = rel(trainOwner, stationOwner);

    // Use actual game values from config
    const goldValue = this.mg.config().trainGold(relationship);

    // Convert BigInt to number for scoring calculations
    return Number(goldValue);
  }

  /**
   * Update traffic when a train arrives
   */
  onTrainArrival(trainExecution: TrainExecution): void {
    this.traffic.trainCount++;
    this.traffic.recentArrivals++;

    // Increase station heat
    this.traffic.heat = Math.min(1.0, this.traffic.heat + 0.1);
    this.traffic.lastHeatUpdate = this.mg.ticks();
  }

  /**
   * Update traffic when a train departs
   */
  onTrainDeparture(trainExecution: TrainExecution): void {
    this.traffic.trainCount = Math.max(0, this.traffic.trainCount - 1);
  }

  /**
   * Calculate edge score for local greedy routing with graduated recency penalties
   */
  private calculateEdgeScore(
    edge: EdgeMetrics,
    stationsAgo: number, // -1 = never visited, 1 = immediate previous, 2 = 2 ago, etc.
    actualProfit: number,
    neighborTrafficHeat: number, // Heat factor of the neighbor station
  ): number {
    // Base score: profit per time unit, boosted by profit-per-distance
    const profitPerDistance = actualProfit / edge.distance;
    let score =
      (actualProfit /
        (edge.baseDuration * (1 + this.distanceSensitivity * edge.distance))) *
      (1 + this.profitSensitivity * profitPerDistance);

    // Apply graduated recency penalty based on stations ago
    if (stationsAgo > 0) {
      const penaltyStrength =
        Math.pow(this.recencyDecayFactor, stationsAgo - 1) *
        this.maxRecencyPenalty;
      const recencyPenalty = 1.0 - penaltyStrength;
      score *= recencyPenalty;
    }

    // Apply station heat avoidance
    score *= 1 - this.stationHeatSensitivity * neighborTrafficHeat;

    // Ensure unvisited stations get a minimum exploration score
    // This prevents zero-profit unvisited stations(facttories) from being ignored
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
    // First priority: Check if we have a known route to the destination
    const knownNextHop = this.getNextHop(destination);
    if (knownNextHop && this.neighbors().includes(knownNextHop)) {
      // We have a known route and the next hop is a valid neighbor
      // With some probability, still explore instead of following known route
      if (this.random.next() >= this.randomChoiceProbability) {
        return knownNextHop;
      }
      // Otherwise, fall through to exploration mode
    }

    // Second priority: Local greedy routing for exploration/unknown routes
    // Trains pick highest-scoring neighbors without considering direction toward destination.
    const validNeighbors: Array<{ station: TrainStation; score: number }> = [];

    // Evaluate all neighboring stations
    for (const neighbor of this.neighbors()) {
      const edge = this.edgeMetrics.get(neighbor);
      if (!edge) continue;

      // Calculate actual profit based on train owner's relationship with station
      const actualProfit = this.calculateActualProfit(trainOwner, neighbor);

      // Calculate how many stations ago this neighbor was visited
      const stationsAgo = this.getStationsAgo(neighbor, recentStations);
      const neighborTrafficHeat = neighbor.getTraffic().heat;
      const score = this.calculateEdgeScore(
        edge,
        stationsAgo,
        actualProfit,
        neighborTrafficHeat,
      );

      validNeighbors.push({ station: neighbor, score });
    }

    if (validNeighbors.length === 0) {
      return null; // No valid neighbors
    }

    // With some probability, make a random choice instead of the best
    if (this.random.next() < this.randomChoiceProbability) {
      // Random choice: pick any valid neighbor uniformly
      const randomIndex = this.random.nextInt(0, validNeighbors.length);
      return validNeighbors[randomIndex].station;
    } else {
      // Best choice: pick the highest scoring neighbor
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

    // Remove edge metrics for this station
    this.edgeMetrics.clear(); // Remove all edges from this station

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

    // Remove edge metrics to/from the removed station
    this.edgeMetrics.delete(removedStation);
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
    if (timeSinceUpdate > 50) {
      // Every 50 ticks
      this.traffic.heat *= 0.95; // Decay heat by 5%
      this.traffic.lastHeatUpdate = currentTime;

      // Reset recent arrivals periodically
      if (timeSinceUpdate > 200) {
        this.traffic.recentArrivals = 0;
      }
    }
  }

  // ===== END LOCAL GREEDY ROUTING METHODS =====
  // ===== END BATMAN ROUTING METHODS =====

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
    return 1;
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
