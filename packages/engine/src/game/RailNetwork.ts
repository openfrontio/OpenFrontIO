import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  DeletableRailroad,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { Player, Unit } from "@openfront/engine/game/Game";
import { StationManager } from "@openfront/engine/game/RailNetworkImpl";
import { TrainStation } from "@openfront/engine/game/TrainStation";

export interface RailNetwork {
  deletableRailroads(player: Player, tile: TileRef): DeletableRailroad[];
  removeRailroad(player: Player, id: number, tile: TileRef): boolean;
  connectStation(station: TrainStation): void;
  removeStation(unit: Unit): void;
  findStationsPath(from: TrainStation, to: TrainStation): TrainStation[];
  stationManager(): StationManager;
  overlappingRailroads(unitType: UnitType, tile: TileRef): TileRef[];
  computeGhostRailPaths(unitType: UnitType, tile: TileRef): TileRef[][];
  recomputeClusters(): void;
}
