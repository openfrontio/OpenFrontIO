import { TradeShipExecution } from "../execution/TradeShipExecution";
import { TrainExecution } from "../execution/TrainExecution";
import { PseudoRandom } from "../PseudoRandom";
import { Game, Unit, UnitType } from "./Game";
import { TileRef } from "./GameMap";
import { GameUpdateType } from "./GameUpdates";
import { Cluster, RailRoad } from "./RailNetwork";

/**
 * Handle train stops at various station types
 */
interface TrainStopHandler {
  onStop(mg: Game, station: TrainStation, trainExecution: TrainExecution): void;
}

class CityStopHandler implements TrainStopHandler {
  onStop(
    mg: Game,
    station: TrainStation,
    trainExecution: TrainExecution,
  ): void {
    const goldBonus = mg.config().trainGold();
    station.unit.owner().addGold(BigInt(goldBonus));
    mg.addUpdate({
      type: GameUpdateType.BonusEvent,
      tile: station.tile(),
      gold: Number(goldBonus),
      workers: 0,
      soldiers: 0,
    });
  }
}

class PortStopHandler implements TrainStopHandler {
  constructor(private random: PseudoRandom) {}
  onStop(
    mg: Game,
    station: TrainStation,
    trainExecution: TrainExecution,
  ): void {
    const unit = station.unit;
    const ports = unit.owner().tradingPorts(unit);
    if (ports.length === 0) return;

    const port = this.random.randElement(ports);
    mg.addExecution(new TradeShipExecution(unit.owner(), unit, port));
  }
}

class FactoryStopHandler implements TrainStopHandler {
  onStop(
    mg: Game,
    station: TrainStation,
    trainExecution: TrainExecution,
  ): void {
    trainExecution.loadCargo();
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
  private cluster: Cluster;
  private railroads: Set<RailRoad> = new Set();
  constructor(
    private mg: Game,
    public unit: Unit,
  ) {
    this.stopHandlers = createTrainStopHandlers(new PseudoRandom(mg.ticks()));
  }

  addRailRoad(railRoad: RailRoad) {
    this.railroads.add(railRoad);
  }

  removeNeighboringRails(station: TrainStation) {
    const toRemove = [...this.railroads].find(
      (r) => r.from === station || r.to === station,
    );
    if (toRemove) {
      this.mg.addUpdate({
        type: GameUpdateType.RailRoadEvent,
        isActive: false,
        tiles: toRemove.tiles,
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

  getRailroads(): Set<RailRoad> {
    return this.railroads;
  }

  setCluster(cluster: Cluster) {
    this.cluster = cluster;
  }

  getCluster(): Cluster {
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
