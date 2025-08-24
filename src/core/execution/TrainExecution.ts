import {
  Execution,
  Game,
  Player,
  TrainType,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { RailNetwork } from "../game/RailNetwork";
import { getOrientedRailroad, OrientedRailroad } from "../game/Railroad";
import { TrainStation } from "../game/TrainStation";

export class TrainExecution implements Execution {
  private active = true;
  private mg: Game | null = null;
  private train: Unit | null = null;
  private readonly cars: Unit[] = [];
  private hasCargo = false;
  private currentTile = 0;
  private readonly spacing = 2;
  private readonly usedTiles: TileRef[] = []; // used for cars behind
  private stations: TrainStation[] = [];
  private currentRailroad: OrientedRailroad | null = null;
  private readonly speed = 2;

  constructor(
    private readonly railNetwork: RailNetwork,
    private readonly player: Player,
    private readonly source: TrainStation,
    private readonly destination: TrainStation,
    private readonly numCars: number,
  ) {}

  public owner(): Player {
    return this.player;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    const stations = this.railNetwork.findStationsPath(
      this.source,
      this.destination,
    );
    if (!stations || stations.length <= 1) {
      this.active = false;
      return;
    }

    this.stations = stations;
    const railroad = getOrientedRailroad(this.stations[0], this.stations[1]);
    if (railroad) {
      this.currentRailroad = railroad;
    } else {
      this.active = false;
      return;
    }

    const spawn = this.player.canBuild(UnitType.Train, this.stations[0].tile());
    if (spawn === false) {
      console.warn("cannot build train");
      this.active = false;
      return;
    }
    this.train = this.createTrainUnits(spawn);
  }

  tick(ticks: number): void {
    if (this.train === null) {
      throw new Error("Not initialized");
    }
    if (!this.train.isActive() || !this.activeSourceOrDestination()) {
      this.deleteTrain();
      return;
    }

    const tile = this.getNextTile();
    if (tile) {
      this.updateCarsPositions(tile);
    } else {
      this.targetReached();
      this.deleteTrain();
    }
  }

  loadCargo() {
    if (this.hasCargo || this.train === null) {
      return;
    }
    this.hasCargo = true;
    // Starts at 1: don't load tail engine
    for (let i = 1; i < this.cars.length; i++) {
      this.cars[i].setLoaded(true);
    }
  }

  private targetReached() {
    if (this.train === null) {
      return;
    }
    this.train.setReachedTarget();
    this.cars.forEach((car: Unit) => {
      car.setReachedTarget();
    });
  }

  private createTrainUnits(tile: TileRef): Unit {
    const train = this.player.buildUnit(UnitType.Train, tile, {
      targetUnit: this.destination.unit,
      trainType: TrainType.Engine,
    });
    // Tail is also an engine, just for cosmetics
    this.cars.push(
      this.player.buildUnit(UnitType.Train, tile, {
        targetUnit: this.destination.unit,
        trainType: TrainType.Engine,
      }),
    );
    for (let i = 0; i < this.numCars; i++) {
      this.cars.push(
        this.player.buildUnit(UnitType.Train, tile, {
          loaded: this.hasCargo,
          trainType: TrainType.Carriage,
        }),
      );
    }
    return train;
  }

  private deleteTrain() {
    this.active = false;
    if (this.train?.isActive()) {
      this.train.delete(false);
    }
    for (const car of this.cars) {
      if (car.isActive()) {
        car.delete(false);
      }
    }
  }

  private activeSourceOrDestination(): boolean {
    return (
      this.stations.length > 1 &&
      this.stations[1].isActive() &&
      this.stations[0].isActive()
    );
  }

  /**
   * Save the tiles the train go through so the cars can reuse them
   * Don't simply save the tiles the engine uses, otherwise the spacing will be dictated by the train speed
   */
  private saveTraversedTiles(from: number, speed: number) {
    if (!this.currentRailroad) {
      return;
    }
    let tileToSave: number = from;
    for (
      let i = 0;
      i < speed && tileToSave < this.currentRailroad.getTiles().length;
      i++
    ) {
      this.saveTile(this.currentRailroad.getTiles()[tileToSave]);
      tileToSave = tileToSave + 1;
    }
  }

  private saveTile(tile: TileRef) {
    this.usedTiles.push(tile);
    if (this.usedTiles.length > this.cars.length * this.spacing + 3) {
      this.usedTiles.shift();
    }
  }

  private updateCarsPositions(newTile: TileRef) {
    if (this.cars.length > 0) {
      for (let i = this.cars.length - 1; i >= 0; --i) {
        const carTileIndex = (i + 1) * this.spacing + 2;
        if (this.usedTiles.length > carTileIndex) {
          this.cars[i].move(this.usedTiles[carTileIndex]);
        }
      }
    }
    if (this.train !== null) {
      this.train.move(newTile);
    }
  }

  private nextStation() {
    if (this.stations.length > 2) {
      this.stations.shift();
      const railRoad = getOrientedRailroad(this.stations[0], this.stations[1]);
      if (railRoad) {
        this.currentRailroad = railRoad;
        return true;
      }
    }
    return false;
  }

  private canTradeWithDestination() {
    return (
      this.stations.length > 1 && this.stations[1].tradeAvailable(this.player)
    );
  }

  private getNextTile(): TileRef | null {
    if (this.currentRailroad === null || !this.canTradeWithDestination()) {
      return null;
    }
    this.saveTraversedTiles(this.currentTile, this.speed);
    this.currentTile = this.currentTile + this.speed;
    const leftOver = this.currentTile - this.currentRailroad.getTiles().length;
    if (leftOver >= 0) {
      // Station reached, pick the next station
      this.stationReached();
      if (!this.nextStation()) {
        return null; // Destination reached (or no valid connection)
      }
      this.currentTile = leftOver;
      this.saveTraversedTiles(0, leftOver);
    }
    return this.currentRailroad.getTiles()[this.currentTile];
  }

  private stationReached() {
    if (this.mg === null || this.player === null) {
      throw new Error("Not initialized");
    }
    this.stations[1].onTrainStop(this);
    return;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
