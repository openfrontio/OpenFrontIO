import { TrainStation } from "./TrainStation";
import { Unit } from "./Game";

export type RailNetwork = {
  connectStation(station: TrainStation): void;
  removeStation(unit: Unit): void;
  findStationsPath(from: TrainStation, to: TrainStation): TrainStation[];
};
