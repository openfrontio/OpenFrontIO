import { z } from "zod";
import { Execution, Game, Unit, UnitType } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { zRef } from "../snapshot/SnapshotType";
import { TrainStationExecution } from "./TrainStationExecution";

export class FactoryExecution implements Execution {
  private active: boolean = true;
  private game: Game;
  private stationCreated = false;

  constructor(private factory: Unit) {}

  init(mg: Game, ticks: number): void {
    this.game = mg;
  }

  tick(ticks: number): void {
    if (!this.stationCreated) {
      this.createStation();
      this.stationCreated = true;
    }
    if (!this.factory.isActive()) {
      this.active = false;
      return;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  private createStation(): void {
    const structures = this.game.nearbyUnits(
      this.factory.tile()!,
      this.game.config().trainStationMaxRange(),
      [UnitType.City, UnitType.Port, UnitType.Factory],
    );

    this.game.addExecution(new TrainStationExecution(this.factory, true));
    for (const { unit } of structures) {
      if (!unit.hasTrainStation()) {
        this.game.addExecution(new TrainStationExecution(unit));
      }
    }
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return FactoryExecutionSnapshot.write({
      active: this.active,
      initialized: this.game !== undefined,
      stationCreated: this.stationCreated,
      factory: w.unit(this.factory),
    });
  }

  restoreSnapshot(s: FactoryState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.game = r.game;
    this.stationCreated = s.stationCreated;
    this.factory = r.unit(s.factory);
  }
}

const FactoryStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  stationCreated: z.boolean(),
  factory: zRef(),
});
type FactoryState = z.infer<typeof FactoryStateSchema>;

export const FactoryExecutionSnapshot = execSnapshotType({
  name: "Factory",
  version: 1,
  schema: FactoryStateSchema,
  cls: () => FactoryExecution,
});
