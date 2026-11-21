import { TileRef } from "@openfront/engine-api/game/GameMap";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import {
  zInt,
  zRandom,
  zRef,
  zTile,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Unit } from "../game/Game";
import { WaterPathFinder } from "../pathfinding/PathFinder";
import { PathStatus } from "../pathfinding/types";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import {
  restoreWaterPathFinder,
  WaterPathFinderSchema,
  waterPathFinderState,
} from "../snapshot/PathfinderSnapshots";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

type Phase = "outbound" | "fishing" | "inbound";

/**
 * A fishing boat sails from its home port to a fishing ground
 * fishingMinDistance..fishingMaxDistance tiles out on the same water body,
 * fishes for fishingLoiterTicks, then brings the catch home: the port's
 * owner is paid fishingGold(distance). Fishing ignores embargoes (it is not
 * trade); enemy warships sink the boats.
 */
export class FishingBoatExecution implements Execution {
  private active = true;
  private mg: Game;
  private boat: Unit | null = null;
  private pathFinder: WaterPathFinder;
  private random: PseudoRandom;
  private ground: TileRef | null = null;
  private phase: Phase = "outbound";
  private loiterLeft = 0;

  constructor(private port: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathFinder = new WaterPathFinder(mg, mg.nextShipStagger("tradeShip"));
    this.random = new PseudoRandom(ticks * 31 + this.port.id());
  }

  tick(ticks: number): void {
    if (this.boat === null) {
      this.launch();
      return;
    }
    if (!this.boat.isActive()) {
      this.active = false;
      return;
    }
    if (!this.port.isActive() || this.port.owner() !== this.boat.owner()) {
      // Home port lost: the crew scuttles the boat.
      this.boat.delete(false);
      this.active = false;
      return;
    }

    switch (this.phase) {
      case "outbound":
        if (this.sail(this.ground!)) {
          this.phase = "fishing";
          this.loiterLeft = this.mg.config().fishingLoiterTicks();
        }
        return;
      case "fishing":
        if (--this.loiterLeft <= 0) {
          this.phase = "inbound";
        }
        return;
      case "inbound":
        if (this.sail(this.port.tile())) {
          this.landCatch();
        }
        return;
    }
  }

  private launch(): void {
    if (!this.port.isActive() || this.port.isUnderConstruction()) {
      this.active = false;
      return;
    }
    const owner = this.port.owner();
    const spawn = owner.canBuild(UnitType.FishingBoat, this.port.tile());
    if (spawn === false) {
      this.active = false;
      return;
    }
    this.ground = this.pickGround();
    if (this.ground === null) {
      this.active = false;
      return;
    }
    this.boat = owner.buildUnit(UnitType.FishingBoat, spawn, {
      targetUnit: this.port,
      targetTile: this.ground,
    });
  }

  /** A random open-water tile at fishing distance on the port's water body. */
  private pickGround(): TileRef | null {
    const mg = this.mg;
    const config = mg.config();
    const portTile = this.port.tile();
    const components = new Set<number>();
    for (const n of mg.neighbors(portTile)) {
      if (!mg.isWater(n)) continue;
      const c = mg.getWaterComponent(n);
      if (c !== null) components.add(c);
    }
    if (components.size === 0) return null;
    const min = config.fishingMinDistance();
    const max = config.fishingMaxDistance();
    const px = mg.x(portTile);
    const py = mg.y(portTile);
    for (let attempt = 0; attempt < 60; attempt++) {
      const x = px + this.random.nextInt(-max, max + 1);
      const y = py + this.random.nextInt(-max, max + 1);
      if (!mg.isValidCoord(x, y)) continue;
      const t = mg.ref(x, y);
      const d = mg.manhattanDist(t, portTile);
      if (d < min || d > max) continue;
      if (!mg.isWater(t) || mg.isShoreline(t) || mg.isImpassable(t)) continue;
      let sameBody = false;
      for (const c of components) {
        if (mg.hasWaterComponent(t, c)) {
          sameBody = true;
          break;
        }
      }
      if (sameBody) return t;
    }
    return null;
  }

  /** One step toward `to`; true once there. */
  private sail(to: TileRef): boolean {
    const result = this.pathFinder.next(this.boat!.tile(), to);
    switch (result.status) {
      case PathStatus.COMPLETE:
        this.boat!.move(result.node);
        return true;
      case PathStatus.NEXT:
        this.boat!.move(result.node);
        return false;
      case PathStatus.NOT_FOUND:
        // Stranded (e.g. the water body changed): head home empty-handed.
        if (this.phase === "outbound") {
          this.phase = "inbound";
        } else {
          this.boat!.delete(false);
          this.active = false;
        }
        return false;
    }
    return false;
  }

  private landCatch(): void {
    const owner = this.port.owner();
    const dist =
      this.ground === null ? 0 : this.mg.manhattanDist(this.ground, this.port.tile());
    const gold = this.mg.config().fishingGold(dist, owner);
    owner.addGold(gold, this.port.tile());
    this.mg.stats().goldWork(owner, gold);
    this.boat!.delete(false);
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return FishingBoatExecutionSnapshot.write({
      active: this.active,
      init:
        this.mg === undefined
          ? null
          : {
              random: w.random(this.random),
              pathFinder: waterPathFinderState(this.pathFinder),
            },
      port: w.unit(this.port),
      boat: w.unitOrNull(this.boat),
      ground: this.ground,
      phase: this.phase,
      loiterLeft: this.loiterLeft,
    });
  }

  restoreSnapshot(s: FishingBoatState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.init !== null) {
      this.mg = r.game;
      this.random = r.random(s.init.random);
      this.pathFinder = restoreWaterPathFinder(r.game, s.init.pathFinder);
    }
    this.port = r.unit(s.port);
    this.boat = r.unitOrNull(s.boat);
    this.ground = s.ground;
    this.phase = s.phase;
    this.loiterLeft = s.loiterLeft;
  }
}

const FishingBoatStateSchema = z.object({
  active: z.boolean(),
  init: z
    .object({ random: zRandom(), pathFinder: WaterPathFinderSchema })
    .nullable(),
  port: zRef(),
  boat: zRef().nullable(),
  ground: zTile().nullable(),
  phase: z.enum(["outbound", "fishing", "inbound"]),
  loiterLeft: zInt(),
});
type FishingBoatState = z.infer<typeof FishingBoatStateSchema>;

export const FishingBoatExecutionSnapshot = execSnapshotType({
  name: "FishingBoat",
  version: 1,
  schema: FishingBoatStateSchema,
  cls: () => FishingBoatExecution,
});
