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

export class CityExecution implements Execution {
  private mg: Game;
  private active: boolean = true;
  private stationCreated = false;

  constructor(private city: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (!this.stationCreated) {
      this.createStation();
      this.stationCreated = true;
    }
    if (!this.city.isActive()) {
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
    const nearbyFactory = this.mg.hasUnitNearby(
      this.city.tile()!,
      this.mg.config().trainStationMaxRange(),
      UnitType.Factory,
    );
    if (nearbyFactory) {
      this.mg.addExecution(new TrainStationExecution(this.city));
    }
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return CityExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      stationCreated: this.stationCreated,
      city: w.unit(this.city),
    });
  }

  restoreSnapshot(s: CityState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.stationCreated = s.stationCreated;
    this.city = r.unit(s.city);
  }
}

const CityStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  stationCreated: z.boolean(),
  city: zRef(),
});
type CityState = z.infer<typeof CityStateSchema>;

export const CityExecutionSnapshot = execSnapshotType({
  name: "City",
  version: 1,
  schema: CityStateSchema,
  cls: () => CityExecution,
});
