import { TrainExecution } from "../execution/TrainExecution";
import { PseudoRandom } from "../PseudoRandom";
import { Game, Player, Unit, UnitType } from "./Game";
import { TileRef } from "./GameMap";
import { GameUpdateType, RailTile, RailType } from "./GameUpdates";
import { Railroad } from "./Railroad";

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
  id: number = -1; // assigned by StationManager
  private readonly stopHandlers: Partial<Record<UnitType, TrainStopHandler>> =
    {};
  private cluster: Cluster | null;
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
