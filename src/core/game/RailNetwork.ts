import { Unit } from "./Game";
import { TileRef } from "./GameMap";
import { TrainStation } from "./TrainStation";

export interface RailPathFinderService {
  findTilePath(from: TileRef, to: TileRef): TileRef[];
  findStationPath(from: TrainStation, to: TrainStation): TrainStation[];
}

export interface RailConnector {
  connect(from: TrainStation, to: TrainStation): boolean;
  disconnect(station: TrainStation): void;
}

export interface RailNetwork {
  connectStation(station: TrainStation): void;
  removeStation(unit: Unit): void;
  findStationsPath(from: TrainStation, to: TrainStation): TrainStation[];
}
