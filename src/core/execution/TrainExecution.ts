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
  private cars: Unit[] = [];
  private hasCargo: boolean = false;
  private currentTile: number = 0;
  private spacing = 2;
  private usedTiles: TileRef[] = []; // used for cars behind
  private currentRailroad: OrientedRailroad | null = null;
  private currentStation: TrainStation | null = null;
  private speed: number = 2;
  // Journey tracking for organic route discovery - simplified to immediate neighbors only
  private hasProcessedArrival: boolean = false;
  private journeyHopCount: number = 0;

  // Local greedy routing properties
  private recentStations: TrainStation[] = []; // Recently visited stations (for loop prevention)
  private maxHops: number = 50; // Maximum hops before giving up
  private recentMemorySize: number = 50; // How many recent stations to remember

  constructor(
    private railNetwork: RailNetwork,
    private player: Player,
    private source: TrainStation,
    private destination: TrainStation,
    private numCars: number,
  ) {}

  public owner(): Player {
    return this.player;
  }

  /**
   * Share journey information with a station for organic route discovery
   */
  public shareJourneyInfo(): {
    routeInformation: Array<{
      destination: TrainStation;
      nextHop: TrainStation | null;
      distance: number;
    }>;
  } {
    const routeInformation: Array<{
      destination: TrainStation;
      nextHop: TrainStation | null;
      distance: number;
    }> = [];

    // Derive routing info from recentStations array
    // recentStations = [oldest, ..., previous, current]
    const immediatePrevious =
      this.recentStations.length > 1
        ? this.recentStations[this.recentStations.length - 2]
        : null;

    // Find the start index for sharing journey information
    // Only share information about stations visited since the last time we passed through the current station
    let startIndex = 0;
    const currentStation = this.recentStations[this.recentStations.length - 1];

    // Look for the last occurrence of current station before the current visit
    for (let i = this.recentStations.length - 2; i >= 0; i--) {
      if (this.recentStations[i] === currentStation) {
        // Found the last previous visit to this station, start sharing from after that visit
        startIndex = i + 1;
        break;
      }
    }

    // Only share routes to stations we visited since our last visit to this station (not including current)
    for (let i = startIndex; i < this.recentStations.length - 1; i++) {
      const destination = this.recentStations[i];
      // For reverse routing: to reach any destination, go through the station we came from
      const nextHop = immediatePrevious;
      // Distance from current station to this destination
      const distance = this.recentStations.length - 1 - i;

      routeInformation.push({
        destination,
        nextHop,
        distance,
      });
    }

    return {
      routeInformation,
    };
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;

    // Validate that source and destination are active
    if (!this.source.isActive() || !this.destination.isActive()) {
      this.active = false;
      return;
    }

    // If source and destination are the same, we're already there
    if (this.source === this.destination) {
      this.active = false;
      return;
    }

    this.currentStation = this.source;

    const spawn = this.player.canBuild(UnitType.Train, this.source.tile());
    if (spawn === false) {
      console.warn(`cannot build train`);
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

    // Record train arrival statistics
    if (this.mg) {
      this.mg.recordTrainArrival(this.journeyHopCount);
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
          trainType: TrainType.Carriage,
          loaded: this.hasCargo,
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
    return this.source.isActive() && this.destination.isActive();
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

  private isAtStation(): boolean {
    if (!this.train || !this.currentStation || !this.mg) return false;

    // Check if train is at the current station's tile
    const trainTile = this.train.tile();
    return (
      this.mg.x(trainTile) === this.mg.x(this.currentStation.tile()) &&
      this.mg.y(trainTile) === this.mg.y(this.currentStation.tile())
    );
  }

  private getNextTile(): TileRef | null {
    // If we're at a station, decide where to go next
    if (this.isAtStation()) {
      // Process arrival if we haven't already for this station visit
      if (!this.hasProcessedArrival) {
        this.stationReached(); // Handle arrival at current station
        this.hasProcessedArrival = true;
      }

      // Check if we've reached the destination
      if (this.currentStation === this.destination) {
        this.targetReached();
        return null;
      }

      // Check if we've exceeded max hops
      if (this.journeyHopCount >= this.maxHops) {
        // Give up - we've wandered too long
        if (this.mg) {
          this.mg.recordTrainRemovedDueToHopLimit(this.journeyHopCount);
        }
        this.active = false;
        return null;
      }

      // Use local greedy routing to choose next station
      const nextHop = this.currentStation!.chooseNextStation(
        this.destination,
        this.recentStations,
        this.player,
      );

      if (!nextHop) {
        // No good options available - stay and wait
        return null;
      }

      // Get railroad to next hop
      const railroad = getOrientedRailroad(this.currentStation!, nextHop);
      if (!railroad) {
        return null; // No direct connection
      }

      // Reset arrival flag since we're departing
      this.hasProcessedArrival = false;

      // Notify current station that train is departing
      this.currentStation!.onTrainDepartureFromStation(this);

      // Update recent stations memory for loop prevention
      this.recentStations.push(nextHop);
      if (this.recentStations.length > this.recentMemorySize) {
        this.recentStations.shift(); // Remove oldest
      }

      // Update journey tracking - remember where we came from BEFORE changing currentStation
      // This should happen after arrival processing but before departure
      this.journeyHopCount++;

      this.currentStation = nextHop;
      this.currentRailroad = railroad;
      this.currentTile = 0;
    }

    // Follow current railroad
    if (
      this.currentRailroad &&
      this.currentTile < this.currentRailroad.getTiles().length
    ) {
      this.saveTraversedTiles(this.currentTile, this.speed);
      this.currentTile += this.speed;

      if (this.currentTile >= this.currentRailroad.getTiles().length) {
        // We've reached the next station
        this.currentTile = this.currentRailroad.getTiles().length - 1;
      }

      return this.currentRailroad.getTiles()[this.currentTile];
    }

    return null;
  }

  private stationReached() {
    if (this.mg === null || this.player === null || !this.currentStation) {
      throw new Error("Not initialized");
    }

    this.currentStation.onTrainStop(this);
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
