import { TrainExecution } from "../execution/TrainExecution";
import { GraphAdapter } from "../pathfinding/SerialAStar";
import { PseudoRandom } from "../PseudoRandom";
import { Game, Gold, Player, Unit, UnitType } from "./Game";
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
  private cluster: Cluster | null;
  private railroads: Set<Railroad> = new Set();
  // Quick lookup from neighboring station to connecting railroad
  private railroadByNeighbor: Map<TrainStation, Railroad> = new Map();

  // 0–1 scalar representing how "full" the station is with paying passengers.
  private passengerFullness: number = 1;
  // Last tick at which we updated passengerFullness.
  private lastPassengerUpdateTick: number;

  constructor(
    private mg: Game,
    public unit: Unit,
  ) {
    this.stopHandlers = createTrainStopHandlers(new PseudoRandom(mg.ticks()));
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
