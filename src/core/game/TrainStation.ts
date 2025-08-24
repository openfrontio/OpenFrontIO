import { TrainExecution } from "../execution/TrainExecution";
import { PseudoRandom } from "../PseudoRandom";
import { GraphAdapter } from "../pathfinding/SerialAStar";
import { Game, Player, Unit, UnitType } from "./Game";
import { TileRef } from "./GameMap";
import { GameUpdateType, RailTile, RailType } from "./GameUpdates";
import { Railroad } from "./Railroad";

/**
 * Handle train stops at various station types
 */
type TrainStopHandler = {
  onStop(mg: Game, station: TrainStation, trainExecution: TrainExecution): void;
};

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
    const level = BigInt(station.unit.level() + 1);
    const stationOwner = station.unit.owner();
    const trainOwner = trainExecution.owner();
    const isFriendly = stationOwner.isFriendly(trainOwner);
    const goldBonus = mg.config().trainGold(isFriendly) * level;
    // Share revenue with the station owner if it's not the current player
    if (isFriendly) {
      stationOwner.addGold(goldBonus, station.tile());
    }
    trainOwner.addGold(goldBonus, station.tile());
  }
}

class PortStopHandler implements TrainStopHandler {
  constructor(private readonly random: PseudoRandom) {}
  onStop(
    mg: Game,
    station: TrainStation,
    trainExecution: TrainExecution,
  ): void {
    const level = BigInt(station.unit.level() + 1);
    const stationOwner = station.unit.owner();
    const trainOwner = trainExecution.owner();
    const isFriendly = stationOwner.isFriendly(trainOwner);
    const goldBonus = mg.config().trainGold(isFriendly) * level;

    if (isFriendly) {
      stationOwner.addGold(goldBonus, station.tile());
    }
    trainOwner.addGold(goldBonus, station.tile());
  }
}

class FactoryStopHandler implements TrainStopHandler {
  onStop(
    mg: Game,
    station: TrainStation,
    trainExecution: TrainExecution,
  ): void {
    const stationOwner = station.unit.owner();
    const trainOwner = trainExecution.owner();
    const isFriendly = stationOwner.isFriendly(trainOwner);
    const goldBonus = mg.config().trainGold(isFriendly);
    // Share revenue with the station owner if it's not the current player
    if (isFriendly) {
      stationOwner.addGold(goldBonus, station.tile());
    }
    trainOwner.addGold(goldBonus, station.tile());
  }
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
  private cluster: Cluster | null = null;
  private readonly railroads: Set<Railroad> = new Set();

  constructor(
    private readonly mg: Game,
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
  }

  addRailroad(railRoad: Railroad) {
    this.railroads.add(railRoad);
  }

  removeNeighboringRails(station: TrainStation) {
    const toRemove = [...this.railroads].find(
      (r) => r.from === station || r.to === station,
    );
    if (toRemove) {
      const railTiles: RailTile[] = toRemove.tiles.map((tile) => ({
        railType: RailType.VERTICAL,
        tile,
      }));
      this.mg.addUpdate({
        isActive: false,
        railTiles,
        type: GameUpdateType.RailroadEvent,
      });
      this.railroads.delete(toRemove);
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

  onTrainStop(trainExecution: TrainExecution) {
    const type = this.unit.type();
    const handler = this.stopHandlers[type];
    if (handler) {
      handler.onStop(this.mg, this, trainExecution);
    }
  }
}

/**
 * Make the trainstation usable with A*
 */
export class TrainStationMapAdapter implements GraphAdapter<TrainStation> {
  constructor(private readonly game: Game) {}

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
      if (station.tradeAvailable(player)) {
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
