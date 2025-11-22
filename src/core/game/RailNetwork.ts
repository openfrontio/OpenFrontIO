import { Unit } from "./Game";
import { TileRef } from "./GameMap";
import { TrainStation } from "./TrainStation";

export interface RailNetwork {
  connectStation(station: TrainStation): void;
  removeStation(unit: Unit): void;
  findStationsPath(from: TrainStation, to: TrainStation): TrainStation[];
  // Notify the rail network that the owner of a tile has changed,
  // so any railroads crossing that tile can update cached territory ownership.
  onTileOwnerChanged(tile: TileRef): void;
}
