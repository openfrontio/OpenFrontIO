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

type MoveResult =
  | { kind: "move"; tile: TileRef }
  | { kind: "arrived" }
  | { kind: "hopLimit" }
  | { kind: "stuck" };

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

  private enterRailroad(railroad: OrientedRailroad) {
    const rail = railroad.getRailroad();
    const ticks = this.mg ? this.mg.ticks() : 0;
    rail.incrementTrainCount(ticks);
    const fare = rail.getFare();
    const tiles = railroad.getTiles();
    const midTile =
      tiles.length > 0
        ? tiles[Math.floor(tiles.length / 2)]
        : railroad.getStart().tile();
    let netFare = fare;

    // Optimization: if the train owner is also the sole territory owner along this railroad,
    // they would immediately get back the full 20% share. In that case, just charge the net
    // 80% fare and skip the distribution step.
    let shouldDistributeShare = true;
    if (
      this.mg &&
      fare > 0n &&
      rail.isSoleTerritoryOwner(this.mg, this.player)
    ) {
      const profitShare = fare / 5n; // 20%
      netFare = fare - profitShare;
      shouldDistributeShare = false;
    }

    // Charge fare (possibly reduced by owner share optimization) to the train owner
    this.player.addGold(-netFare, midTile);

    // Share 20% of the fare with territory owners along the railroad,
    // proportional to the number of tiles they own under this track.
    if (shouldDistributeShare && this.mg && fare > 0n) {
      rail.distributeFareShare(this.mg, fare);
    }
    // Update client-side coloring when fare changes significantly
    if (this.mg !== null) {
      rail.updateFare(this.mg);
    }
  }

  private leaveRailroad() {
    if (!this.currentRailroad) {
      return;
    }
    const rail = this.currentRailroad.getRailroad();
    const ticks = this.mg ? this.mg.ticks() : 0;
    rail.decrementTrainCount(ticks);
    // Update client-side coloring when fare changes significantly
    if (this.mg !== null) {
      rail.updateFare(this.mg);
    }
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

    const result = this.getNextStep();
    switch (result.kind) {
      case "move":
        this.updateCarsPositions(result.tile);
        break;
      case "arrived":
        this.targetReached();
        this.deleteTrain();
        break;
      case "hopLimit":
        if (this.mg) {
          this.mg.recordTrainRemovedDueToHopLimit(this.journeyHopCount);
        }
        this.deleteTrain();
        break;
      case "stuck":
        this.deleteTrain();
        break;
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
    this.leaveRailroad();

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

  private getNextStep(): MoveResult {
    // If we're at a station, decide where to go next
    if (this.isAtStation()) {
      // Process arrival if we haven't already for this station visit
      if (!this.hasProcessedArrival) {
        this.stationReached(); // Handle arrival at current station
        this.hasProcessedArrival = true;
      }

      // Check if we've reached the destination
      if (this.currentStation === this.destination) {
        return { kind: "arrived" };
      }

      // Check if we've exceeded max hops
      if (this.journeyHopCount >= this.maxHops) {
        // Give up - we've wandered too long
        this.active = false;
        return { kind: "hopLimit" };
      }

      // Use local greedy routing to choose next station
      const nextHop = this.currentStation!.chooseNextStation(
        this.destination,
        this.recentStations,
        this.player,
      );

      if (!nextHop) {
        // No good options available - treat as stuck
        this.active = false;
        return { kind: "stuck" };
      }

      // Get railroad to next hop
      const railroad = getOrientedRailroad(this.currentStation!, nextHop);
      if (!railroad) {
        this.active = false;
        return { kind: "stuck" }; // No direct connection
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

      // Move to the next station and railroad, updating fare/usage tracking
      this.currentStation = nextHop;
      this.leaveRailroad();
      this.currentRailroad = railroad;
      this.enterRailroad(railroad);
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

      return {
        kind: "move",
        tile: this.currentRailroad.getTiles()[this.currentTile],
      };
    }

    this.active = false;
    return { kind: "stuck" };
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
