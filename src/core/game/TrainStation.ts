import { TrainExecution } from "../execution/TrainExecution";
import { PseudoRandom } from "../PseudoRandom";
import { isFuelConsumer } from "./Fuel";
import { Game, Player, TrainMission, Unit, UnitType } from "./Game";
import { TileRef } from "./GameMap";
import { GameUpdateType } from "./GameUpdates";
import { Railroad } from "./Railroad";

/**
 * Handle train stops at various station types
 */
interface TrainStopHandler {
  onStop(mg: Game, station: TrainStation, trainExecution: TrainExecution): void;
}

class TradeStationStopHandler implements TrainStopHandler {
  onStop(
    mg: Game,
    station: TrainStation,
    trainExecution: TrainExecution,
  ): void {
    if (trainExecution.trainMission() !== "trade") {
      return;
    }
    const stationOwner = station.unit.owner();
    const trainOwner = trainExecution.owner();
    const gold = mg
      .config()
      .trainGold(
        rel(trainOwner, stationOwner),
        trainExecution.tradeStopsVisited(),
        trainOwner,
      );
    // Share revenue with the station owner if it's not the current player
    if (trainOwner !== stationOwner) {
      stationOwner.addGold(gold, station.tile());
      mg.stats().trainExternalTrade(stationOwner, gold);
    }
    trainOwner.addGold(gold, station.tile());
    mg.stats().trainSelfTrade(trainOwner, gold);
  }
}

class FuelStopHandler implements TrainStopHandler {
  onStop(
    mg: Game,
    station: TrainStation,
    trainExecution: TrainExecution,
  ): void {
    if (trainExecution.trainMission() !== "freight") {
      return;
    }
    if (!isFuelConsumer(station.unit.type())) {
      return;
    }

    const accepted = station.unit.addFuel(trainExecution.fuelRemaining());
    if (accepted <= 0) {
      return;
    }

    trainExecution.deliverFuel(accepted);

    const stationOwner = station.unit.owner();
    const trainOwner = trainExecution.owner();
    if (stationOwner !== trainOwner) {
      const gold =
        (mg.config().trainGold(rel(trainOwner, stationOwner), 0, trainOwner) *
          BigInt(Math.round(mg.config().fuelAllyGoldMultiplier() * 1000))) /
        1000n;
      trainOwner.addGold(gold, station.tile(), "oil");
      mg.stats().trainSelfTrade(trainOwner, gold);
    }
  }
}

export function createTrainStopHandlers(
  random: PseudoRandom,
): Partial<Record<UnitType, TrainStopHandler>> {
  const tradeStationStopHandler = new TradeStationStopHandler();
  const fuelStopHandler = new FuelStopHandler();
  return {
    [UnitType.City]: combineStopHandlers(
      tradeStationStopHandler,
      fuelStopHandler,
    ),
    [UnitType.Port]: combineStopHandlers(
      tradeStationStopHandler,
      fuelStopHandler,
    ),
    [UnitType.OilRig]: tradeStationStopHandler,
    [UnitType.Factory]: fuelStopHandler,
    [UnitType.MissileSilo]: fuelStopHandler,
  };
}

function combineStopHandlers(
  ...handlers: TrainStopHandler[]
): TrainStopHandler {
  return {
    onStop(mg: Game, station: TrainStation, trainExecution: TrainExecution) {
      for (const handler of handlers) {
        handler.onStop(mg, station, trainExecution);
      }
    },
  };
}

export class TrainStation {
  id: number = -1; // assigned by StationManager
  private readonly stopHandlers: Partial<Record<UnitType, TrainStopHandler>> =
    {};
  private cluster: Cluster | null = null;
  private railroads: Set<Railroad> = new Set();
  // Quick lookup from neighboring station to connecting railroad
  private railroadByNeighbor: Map<TrainStation, Railroad> = new Map();

  constructor(
    private mg: Game,
    public unit: Unit,
  ) {
    this.stopHandlers = createTrainStopHandlers(new PseudoRandom(mg.ticks()));
  }

  tradeAvailable(otherPlayer: Player): boolean {
    const player = this.unit.owner();
    return otherPlayer === player || player.canTrade(otherPlayer);
  }

  fuelAvailable(otherPlayer: Player): boolean {
    const player = this.unit.owner();
    return (
      otherPlayer === player ||
      (otherPlayer.isFriendly(player) && otherPlayer.canTrade(player))
    );
  }

  availableForTrain(otherPlayer: Player, mission: TrainMission): boolean {
    if (mission === "freight") {
      return this.fuelAvailable(otherPlayer);
    }
    return this.tradeAvailable(otherPlayer);
  }

  clearRailroads() {
    this.railroads.clear();
    this.railroadByNeighbor.clear();
  }

  addRailroad(railRoad: Railroad) {
    this.railroads.add(railRoad);
    const neighbor = railRoad.from === this ? railRoad.to : railRoad.from;
    this.railroadByNeighbor.set(neighbor, railRoad);
  }

  removeRailroad(railRoad: Railroad) {
    this.railroads.delete(railRoad);
    const neighbor = railRoad.from === this ? railRoad.to : railRoad.from;
    this.railroadByNeighbor.delete(neighbor);
  }

  removeNeighboringRails(station: TrainStation) {
    const toRemove = [...this.railroads].find(
      (r) => r.from === station || r.to === station,
    );
    if (toRemove) {
      this.mg.addUpdate({
        type: GameUpdateType.RailroadDestructionEvent,
        id: toRemove.id,
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
    // Properly disconnect cluster if it's already set
    if (this.cluster !== null) {
      this.cluster.removeStation(this);
    }
    this.cluster = cluster;
  }

  getCluster(): Cluster | null {
    return this.cluster;
  }

  onTrainStop(trainExecution: TrainExecution) {
    const type = this.unit.type();
    const handler = this.stopHandlers[type];
    if (handler) {
      handler.onStop(this.mg, this, trainExecution);
    }
  }
}

/**
 * Cluster of connected stations
 */
export class Cluster {
  public stations: Set<TrainStation> = new Set();
  private tradeStations: Set<TrainStation> = new Set();
  private fuelStations: Set<TrainStation> = new Set();

  private isTradeStation(station: TrainStation): boolean {
    const type = station.unit.type();
    return (
      type === UnitType.City ||
      type === UnitType.Port ||
      type === UnitType.OilRig
    );
  }

  has(station: TrainStation) {
    return this.stations.has(station);
  }

  addStation(station: TrainStation) {
    this.stations.add(station);
    if (this.isTradeStation(station)) {
      this.tradeStations.add(station);
    }
    if (isFuelConsumer(station.unit.type())) {
      this.fuelStations.add(station);
    }
    station.setCluster(this);
  }

  removeStation(station: TrainStation) {
    this.stations.delete(station);
    this.tradeStations.delete(station);
    this.fuelStations.delete(station);
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

  hasAnyTradeDestination(player: Player): boolean {
    for (const station of this.tradeStations) {
      if (station.tradeAvailable(player)) {
        return true;
      }
    }
    return false;
  }

  randomTradeDestination(
    player: Player,
    random: PseudoRandom,
  ): TrainStation | null {
    let selected: TrainStation | null = null;
    let eligibleSeen = 0;

    for (const station of this.tradeStations) {
      if (!station.tradeAvailable(player)) continue;
      eligibleSeen++;

      // Reservoir sampling: keep each eligible station with probability 1/eligibleSeen.
      if (random.nextInt(0, eligibleSeen) === 0) {
        selected = station;
      }
    }

    return selected;
  }

  availableForTrade(player: Player): Set<TrainStation> {
    const tradingStations = new Set<TrainStation>();
    for (const station of this.tradeStations) {
      if (station.tradeAvailable(player)) {
        tradingStations.add(station);
      }
    }
    return tradingStations;
  }

  nearestOwnedFactory(from: TrainStation, player: Player): TrainStation | null {
    let selected: TrainStation | null = null;
    let selectedDistance = Number.POSITIVE_INFINITY;

    for (const station of this.stations) {
      if (station === from) {
        continue;
      }
      if (station.unit.type() !== UnitType.Factory) {
        continue;
      }
      if (station.unit.owner() !== player) {
        continue;
      }

      const distance = railroadDistance(from, station, (next) =>
        next.fuelAvailable(player),
      );
      if (distance < selectedDistance) {
        selected = station;
        selectedDistance = distance;
      }
    }

    return selected;
  }

  farthestFuelDestination(
    from: TrainStation,
    player: Player,
  ): TrainStation | null {
    let selected: TrainStation | null = null;
    let selectedDistance = Number.NEGATIVE_INFINITY;

    for (const station of this.fuelStations) {
      if (station === from) {
        continue;
      }
      if (!station.fuelAvailable(player)) {
        continue;
      }

      const distance = railroadDistance(from, station);
      if (!Number.isFinite(distance) || distance <= selectedDistance) {
        continue;
      }

      selected = station;
      selectedDistance = distance;
    }

    return selected;
  }

  randomFuelDestination(
    from: TrainStation,
    player: Player,
  ): TrainStation | null {
    let selected: TrainStation | null = null;
    let eligibleSeen = 0;

    for (const station of this.fuelStations) {
      if (station === from) {
        continue;
      }
      if (!station.fuelAvailable(player)) {
        continue;
      }
      eligibleSeen++;

      // Reservoir sampling: keep each eligible station with probability 1/eligibleSeen.
      if (Math.floor(Math.random() * (eligibleSeen + 1)) === 0) {
        selected = station;
      }
    }

    return selected;
  }

  size() {
    return this.stations.size;
  }

  clear() {
    this.stations.clear();
    this.tradeStations.clear();
    this.fuelStations.clear();
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

function railroadDistance(
  from: TrainStation,
  to: TrainStation,
  canVisit: (station: TrainStation) => boolean = () => true,
): number {
  if (from === to) {
    return 0;
  }

  const bestDistance = new Map<TrainStation, number>([[from, 0]]);
  const queue: Array<{ station: TrainStation; distance: number }> = [
    { station: from, distance: 0 },
  ];

  while (queue.length > 0) {
    queue.sort((a, b) => a.distance - b.distance);
    const current = queue.shift()!;
    if (
      current.distance >
      (bestDistance.get(current.station) ?? Number.POSITIVE_INFINITY)
    ) {
      continue;
    }

    for (const neighbor of current.station.neighbors()) {
      if (!canVisit(neighbor)) {
        continue;
      }
      const rail = current.station.getRailroadTo(neighbor);
      if (!rail) {
        continue;
      }

      const nextDistance = current.distance + rail.tiles.length;
      if (neighbor === to) {
        return nextDistance;
      }

      if (
        nextDistance >= (bestDistance.get(neighbor) ?? Number.POSITIVE_INFINITY)
      ) {
        continue;
      }

      bestDistance.set(neighbor, nextDistance);
      queue.push({ station: neighbor, distance: nextDistance });
    }
  }

  return Number.POSITIVE_INFINITY;
}
