import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  MessageType,
  TerraNullius,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { listNukeBreakAlliance } from "@openfront/engine-lib/execution/NukeAlliance";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import {
  zInt,
  zPlayerRef,
  zRef,
  zTile,
  zTiles,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { simpleHash } from "@openfront/engine-lib/Util";
import { z } from "zod";
import { Execution, Game, Player, Unit } from "../game/Game";
import { UniversalPathFinding } from "../pathfinding/PathFinder";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { NukeExecution } from "./NukeExecution";

// Unit circle at 45° steps, scaled by 1000 (constants, so no trig is needed
// and every client computes the same offsets).
const RING_DIRECTIONS: readonly [number, number][] = [
  [1000, 0],
  [707, 707],
  [0, 1000],
  [-707, 707],
  [-1000, 0],
  [-707, -707],
  [0, -1000],
  [707, -707],
];
const RING_RADIUS_JITTER = 8;
// The carrier splits once it has flown this share of its path (per mille).
const SEPARATION_PER_MILLE = 800;

/**
 * A cluster nuke: one carrier missile, fired from a level-2+ silo, that
 * splits near its target into clusterNukeWarheads() atom-sized warheads —
 * one on the aim point and the rest on a ring clusterNukeSpread() tiles out.
 * Shooting the carrier down before it splits stops the whole salvo.
 */
export class ClusterNukeExecution implements Execution {
  private active = true;
  private mg: Game;
  private carrier: Unit | null = null;
  private path: TileRef[] = [];
  private pathIndex = 0;
  private separateAt = 0;
  private warheads: NukeExecution[] = [];
  private split = false;

  constructor(
    private player: Player,
    private dst: TileRef,
    private rocketDirectionUp: boolean = true,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.carrier === null) {
      this.launch(ticks);
      return;
    }

    if (!this.carrier.isActive()) {
      // Intercepted before it split: nothing else happens.
      this.active = false;
      return;
    }

    if (this.pathIndex < this.separateAt) {
      this.carrier.move(this.path[this.pathIndex]);
      this.carrier.setTrajectoryIndex(this.pathIndex);
      this.pathIndex++;
      return;
    }

    this.separate();
  }

  private launch(ticks: number): void {
    const spawn = this.player.canBuild(UnitType.ClusterNuke, this.dst);
    if (spawn === false) {
      console.warn(`cannot build Cluster Nuke`);
      this.active = false;
      return;
    }
    const pathFinder = UniversalPathFinding.Parabola(this.mg, {
      increment: this.mg.config().nukeSpeed(UnitType.ClusterNuke),
      directionUp: this.rocketDirectionUp,
    });
    this.path = pathFinder.findPath(spawn, this.dst) ?? [];
    if (this.path.length === 0) {
      this.path = [this.dst];
    }
    this.separateAt = Math.max(
      1,
      Math.floor((this.path.length * SEPARATION_PER_MILLE) / 1000),
    );
    this.carrier = this.player.buildUnit(UnitType.ClusterNuke, spawn, {
      targetTile: this.dst,
      trajectory: this.path,
    });
    this.mg.recordMotionPlan({
      kind: "grid",
      unitId: this.carrier.id(),
      planId: 1,
      startTick: ticks + 1,
      ticksPerStep: 1,
      path: this.path.slice(0, this.separateAt),
    });

    this.breakAlliances();

    const target = this.target();
    if (target.isPlayer()) {
      this.mg.displayIncomingUnit(
        this.carrier.id(),
        "events_display.cluster_nuke_inbound",
        MessageType.NUKE_INBOUND,
        target.id(),
      );
    }
    this.mg.stats().bombLaunch(this.player, target, UnitType.ClusterNuke);

    const silo = this.player
      .units(UnitType.MissileSilo)
      .find((s) => s.tile() === spawn);
    silo?.launch();
  }

  /** The whole salvo's footprint breaks alliances once, at launch. */
  private breakAlliances(): void {
    const players = listNukeBreakAlliance({
      game: this.mg,
      targetTile: this.dst,
      magnitude: this.mg.config().nukeMagnitudes(UnitType.ClusterNuke),
      threshold: this.mg.config().nukeAllianceBreakThreshold(),
    });
    for (const incoming of this.player.incomingAllianceRequests()) {
      if (players.has(incoming.requestor().smallID())) {
        incoming.reject();
      }
    }
    for (const smallID of players) {
      const attacked = this.mg.playerBySmallID(smallID);
      if (!attacked.isPlayer()) continue;
      const pending = attacked
        .incomingAllianceRequests()
        .find((ar) => ar.requestor() === this.player);
      if (pending) {
        pending.reject();
        continue;
      }
      const alliance = this.player.allianceWith(attacked);
      if (alliance !== null) {
        this.player.breakAlliance(alliance);
      }
      if (attacked !== this.player) {
        attacked.updateRelation(this.player, -100);
      }
    }
  }

  /** Where each warhead lands: the aim point, then a jittered ring. */
  warheadTargets(): TileRef[] {
    const config = this.mg.config();
    const rand = new PseudoRandom(
      simpleHash(`${this.player.id()}:${this.dst}:${this.carrier?.id() ?? 0}`),
    );
    const cx = this.mg.x(this.dst);
    const cy = this.mg.y(this.dst);
    const spread = config.clusterNukeSpread();
    const ringCount = config.clusterNukeWarheads() - 1;
    const step = Math.max(1, Math.floor(RING_DIRECTIONS.length / ringCount));
    const rotation = rand.nextInt(0, RING_DIRECTIONS.length);
    const targets: TileRef[] = [this.dst];
    for (let k = 0; k < ringCount; k++) {
      const [dx, dy] =
        RING_DIRECTIONS[(rotation + k * step) % RING_DIRECTIONS.length];
      const r = spread + rand.nextInt(-RING_RADIUS_JITTER, RING_RADIUS_JITTER + 1);
      const x = Math.max(
        0,
        Math.min(this.mg.width() - 1, cx + Math.trunc((dx * r) / 1000)),
      );
      const y = Math.max(
        0,
        Math.min(this.mg.height() - 1, cy + Math.trunc((dy * r) / 1000)),
      );
      const t = this.mg.ref(x, y);
      targets.push(this.mg.isImpassable(t) ? this.dst : t);
    }
    return targets;
  }

  private separate(): void {
    if (this.carrier === null || this.split) return;
    this.split = true;
    const from = this.carrier.tile();
    for (const t of this.warheadTargets()) {
      const exec = new NukeExecution(
        UnitType.ClusterWarhead,
        this.player,
        t,
        from,
        this.mg.config().nukeSpeed(UnitType.ClusterWarhead),
        0,
        this.rocketDirectionUp,
      );
      this.warheads.push(exec);
      this.mg.addExecution(exec);
    }
    this.carrier.setReachedTarget();
    this.carrier.delete(false);
    this.active = false;
  }

  target(): Player | TerraNullius {
    return this.mg.owner(this.dst);
  }

  owner(): Player {
    return this.player;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return ClusterNukeExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      player: w.player(this.player),
      dst: this.dst,
      rocketDirectionUp: this.rocketDirectionUp,
      carrier: w.unitOrNull(this.carrier),
      path: w.tiles(this.path),
      pathIndex: this.pathIndex,
      separateAt: this.separateAt,
      split: this.split,
      warheads: this.warheads.map((e) => w.exec(e)),
    });
  }

  restoreSnapshot(s: ClusterNukeState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.player = r.player(s.player);
    this.dst = s.dst;
    this.rocketDirectionUp = s.rocketDirectionUp;
    this.carrier = r.unitOrNull(s.carrier);
    this.path = Array.from(s.path);
    this.pathIndex = s.pathIndex;
    this.separateAt = s.separateAt;
    this.split = s.split;
    this.warheads = s.warheads.map((i) => r.exec<NukeExecution>(i));
  }
}

const ClusterNukeStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  player: zPlayerRef(),
  dst: zTile(),
  rocketDirectionUp: z.boolean(),
  carrier: zRef().nullable(),
  path: zTiles(),
  pathIndex: zInt(),
  separateAt: zInt(),
  split: z.boolean(),
  warheads: z.array(zRef()),
});
type ClusterNukeState = z.infer<typeof ClusterNukeStateSchema>;

export const ClusterNukeExecutionSnapshot = execSnapshotType({
  name: "ClusterNuke",
  version: 1,
  schema: ClusterNukeStateSchema,
  cls: () => ClusterNukeExecution,
});
