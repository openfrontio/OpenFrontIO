import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { AIRPORT } from "@openfront/engine-lib/game/ModRules";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import {
  zInt,
  zRandom,
  zRef,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { CargoPlaneExecution } from "./CargoPlaneExecution";

/**
 * An airport earns money the way a port does: it sends cargo planes to other
 * players' airports and both ends are paid when one lands. Fighter jets can
 * steal planes in flight (see FighterJetExecution).
 */
export class AirportExecution implements Execution {
  private active = true;
  private mg: Game;
  private random: PseudoRandom;
  private checkOffset: number;

  constructor(private airport: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.random = new PseudoRandom(mg.ticks() + this.airport.id());
    this.checkOffset = mg.ticks() % 10;
  }

  tick(ticks: number): void {
    if (!this.airport.isActive()) {
      this.active = false;
      return;
    }
    if (this.airport.isUnderConstruction()) {
      return;
    }
    // Once per second.
    if ((this.mg.ticks() + this.checkOffset) % 10 !== 0) {
      return;
    }
    if (!this.shouldLaunchPlane()) {
      return;
    }
    const destination = this.pickDestination();
    if (destination === undefined) {
      return;
    }
    this.mg.addExecution(
      new CargoPlaneExecution(this.airport.owner(), this.airport, destination),
    );
  }

  private shouldLaunchPlane(): boolean {
    const owner = this.airport.owner();
    const airportLevels = owner.unitCount(UnitType.Airport);
    if (
      owner.unitCount(UnitType.CargoPlane) >=
      airportLevels * AIRPORT.maxPlanesPerLevel
    ) {
      return false;
    }
    const odds = Math.max(
      1,
      Math.floor(AIRPORT.planeSpawnBase / this.airport.level()),
    );
    return this.random.chance(odds);
  }

  /** Other players' ready airports in range; closer and higher-level ones are likelier. */
  private pickDestination(): Unit | undefined {
    const owner = this.airport.owner();
    const here = this.airport.tile();
    const weighted: Unit[] = [];
    for (const other of this.mg.players()) {
      if (other === owner || !other.canTrade(owner)) continue;
      for (const airport of other.units(UnitType.Airport)) {
        if (!airport.isActive() || airport.isUnderConstruction()) continue;
        const dist = this.mg.manhattanDist(here, airport.tile());
        if (
          dist < AIRPORT.minRouteDistance ||
          dist > AIRPORT.maxRouteDistance
        ) {
          continue;
        }
        let weight = airport.level();
        if (dist < AIRPORT.maxRouteDistance / 2) weight *= 2;
        if (owner.isFriendly(other)) weight *= 2;
        for (let i = 0; i < weight; i++) weighted.push(airport);
      }
    }
    if (weighted.length === 0) return undefined;
    return this.random.randElement(weighted);
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return AirportExecutionSnapshot.write({
      active: this.active,
      airport: w.unit(this.airport),
      init:
        this.mg !== undefined
          ? { random: w.random(this.random), checkOffset: this.checkOffset }
          : null,
    });
  }

  restoreSnapshot(s: AirportState, r: SnapshotReader): void {
    this.active = s.active;
    this.airport = r.unit(s.airport);
    if (s.init !== null) {
      this.mg = r.game;
      this.random = r.random(s.init.random);
      this.checkOffset = s.init.checkOffset;
    }
  }
}

const AirportStateSchema = z.object({
  active: z.boolean(),
  airport: zRef(),
  // Set by init.
  init: z.object({ random: zRandom(), checkOffset: zInt() }).nullable(),
});
type AirportState = z.infer<typeof AirportStateSchema>;

export const AirportExecutionSnapshot = execSnapshotType({
  name: "Airport",
  version: 1,
  schema: AirportStateSchema,
  cls: () => AirportExecution,
});
