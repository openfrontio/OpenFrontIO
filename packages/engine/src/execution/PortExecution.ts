import { UnitType } from "@openfront/engine-api/game/GameTypes";
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
import { TradeShipExecution } from "./TradeShipExecution";
import { TrainStationExecution } from "./TrainStationExecution";

export interface WeightedPort {
  port: Unit;
  weight: number;
}

export class PortExecution implements Execution {
  private active = true;
  private mg: Game;
  private port: Unit;
  private random: PseudoRandom;
  private checkOffset: number;
  private tradeShipSpawnRejections = 0;

  constructor(port: Unit) {
    this.port = port;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.random = new PseudoRandom(mg.ticks());
    this.checkOffset = mg.ticks() % 10;
  }

  tick(ticks: number): void {
    if (this.mg === null || this.random === null || this.checkOffset === null) {
      throw new Error("Not initialized");
    }

    if (!this.port.isActive()) {
      this.active = false;
      return;
    }

    if (this.port.isUnderConstruction()) {
      return;
    }

    if (!this.port.hasTrainStation()) {
      this.createStation();
    }

    // Only check every 10 ticks for performance.
    if ((this.mg.ticks() + this.checkOffset) % 10 !== 0) {
      return;
    }

    if (!this.shouldSpawnTradeShip()) {
      return;
    }

    const port = this.pickTradingPort(this.tradingPorts());
    if (port === null) {
      return;
    }

    this.mg.addExecution(
      new TradeShipExecution(this.port.owner(), this.port, port),
    );
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  shouldSpawnTradeShip(): boolean {
    const numTradeShips = this.mg.unitCount(UnitType.TradeShip);
    const portLevels = this.port!.owner().unitCount(UnitType.Port);
    for (let i = 0; i < this.port!.level(); i++) {
      const spawnRate = this.mg
        .config()
        .tradeShipSpawnRate(
          this.tradeShipSpawnRejections,
          numTradeShips,
          portLevels,
        );
      if (this.random.chance(spawnRate)) {
        this.tradeShipSpawnRejections = 0;
        return true;
      }
      this.tradeShipSpawnRejections++;
    }
    return false;
  }

  createStation(): void {
    const nearbyFactory = this.mg.hasUnitNearby(
      this.port.tile()!,
      this.mg.config().trainStationMaxRange(),
      UnitType.Factory,
    );
    if (nearbyFactory) {
      this.mg.addExecution(new TrainStationExecution(this.port));
    }
  }

  tradingPorts(): WeightedPort[] {
    const sourceComponents = new Set<number>();
    for (const neighbor of this.mg.neighbors(this.port!.tile())) {
      if (!this.mg.isWater(neighbor)) continue;
      const comp = this.mg.getWaterComponent(neighbor);
      if (comp !== null) sourceComponents.add(comp);
    }
    const ports = this.mg
      .players()
      .filter((p) => p !== this.port!.owner() && p.canTrade(this.port!.owner()))
      .flatMap((p) => p.units(UnitType.Port))
      .filter((p) => {
        for (const comp of sourceComponents) {
          if (this.mg.hasWaterComponent(p.tile(), comp)) return true;
        }
        return false;
      })
      .sort((p1, p2) => {
        return (
          this.mg.manhattanDist(this.port!.tile(), p1.tile()) -
          this.mg.manhattanDist(this.port!.tile(), p2.tile())
        );
      });

    return ports.map((otherPort, i) => {
      let multiplier = 1;
      const tooClose =
        this.mg.manhattanDist(this.port!.tile(), otherPort.tile()) <
        this.mg.config().tradeShipShortRangeDebuff();
      const closeBonus =
        i < this.mg.config().proximityBonusPortsNb(ports.length);
      if (!tooClose && closeBonus) {
        multiplier++;
      }
      if (!tooClose && this.port!.owner().isFriendly(otherPort.owner())) {
        multiplier++;
      }
      return { port: otherPort, weight: otherPort.level() * multiplier };
    });
  }

  pickTradingPort(ports: WeightedPort[]): Unit | null {
    let total = 0;
    for (const { weight } of ports) total += weight;
    if (total === 0) {
      return null;
    }
    let roll = this.random.nextInt(0, total);
    for (const { port, weight } of ports) {
      if (roll < weight) return port;
      roll -= weight;
    }
    throw new Error("unreachable: roll exceeded total weight");
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    const initialized = this.mg !== undefined;
    return PortExecutionSnapshot.write({
      active: this.active,
      port: w.unit(this.port),
      init: initialized
        ? { random: w.random(this.random), checkOffset: this.checkOffset }
        : null,
      tradeShipSpawnRejections: this.tradeShipSpawnRejections,
    });
  }

  restoreSnapshot(s: PortState, r: SnapshotReader): void {
    this.active = s.active;
    this.port = r.unit(s.port);
    if (s.init !== null) {
      this.mg = r.game;
      this.random = r.random(s.init.random);
      this.checkOffset = s.init.checkOffset;
    }
    this.tradeShipSpawnRejections = s.tradeShipSpawnRejections;
  }
}

const PortStateSchema = z.object({
  active: z.boolean(),
  port: zRef(),
  // Set by init.
  init: z.object({ random: zRandom(), checkOffset: zInt() }).nullable(),
  tradeShipSpawnRejections: zInt(),
});
type PortState = z.infer<typeof PortStateSchema>;

export const PortExecutionSnapshot = execSnapshotType({
  name: "Port",
  version: 1,
  schema: PortStateSchema,
  cls: () => PortExecution,
});
