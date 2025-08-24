import { Unit } from "./Game";
import { TrainStation } from "./TrainStation";

export type RailNetwork = {
  connectStation(station: TrainStation): void;
  removeStation(unit: Unit): void;
  findStationsPath(from: TrainStation, to: TrainStation): TrainStation[];
};
