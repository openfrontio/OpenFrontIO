import { renderNumber } from "../../client/Utils";
import {
  Execution,
  Game,
  MessageType,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { findClosestBy } from "../Util";

export class PlaneExecution implements Execution {
  private static readonly TILES_PER_TICK = 2;
  private static readonly MAX_TURNS = 4;

  private active = true;
  private game: Game;
  private plane: Unit | undefined;
  private wasCaptured = false;
  private tilesTraveled = 0;
  private motionPlanId = 1;
  private motionPlanDst: TileRef | null = null;
  private currentPath: TileRef[] = [];
  private pathIndex = 0;

  constructor(
    private origOwner: Player,
    private srcAirport: Unit,
    private dstAirportUnit: Unit,
  ) {}

  init(game: Game, ticks: number): void {
    this.game = game;
  }

  tick(ticks: number): void {
    if (this.plane === undefined) {
      const spawn = this.origOwner.canBuild(UnitType.Plane, this.srcAirport.tile());
      if (spawn === false) {
        console.warn("cannot build plane");
        this.active = false;
        return;
      }
      this.plane = this.origOwner.buildUnit(UnitType.Plane, spawn, {
        targetUnit: this.dstAirportUnit,
      });
      this.resetPath(ticks);
      this.game.stats().boatSendTrade(this.origOwner, this.dstAirportUnit.owner());
    }

    if (!this.plane.isActive()) {
      this.active = false;
      return;
    }

    const planeOwner = this.plane.owner();
    const dstOwner = this.dstAirportUnit.owner();

    if (!this.wasCaptured && this.origOwner !== planeOwner) {
      this.wasCaptured = true;
      this.game.displayMessage(
        "events_display.trade_ship_captured",
        MessageType.UNIT_DESTROYED,
        this.origOwner.id(),
        undefined,
        { name: planeOwner.displayName() },
        this.plane.id(),
      );
    }

    // If source and destination now share owner due capture, cancel flight.
    if (dstOwner.id() === this.srcAirport.owner().id()) {
      this.plane.delete(false);
      this.active = false;
      return;
    }

    if (!this.wasCaptured && (!this.dstAirportUnit.isActive() || !planeOwner.canTrade(dstOwner))) {
      this.plane.delete(false);
      this.active = false;
      return;
    }

    const curTile = this.plane.tile();

    if (this.wasCaptured && (planeOwner !== dstOwner || !this.dstAirportUnit.isActive())) {
      const nearestAirport = findClosestBy(
        planeOwner.units(UnitType.Airport),
        (airport) => this.game.manhattanDist(airport.tile(), curTile),
        (airport) =>
          airport.isActive() && !airport.isMarkedForDeletion() && !airport.isUnderConstruction(),
      );
      if (nearestAirport === null) {
        this.plane.delete(false);
        this.active = false;
        return;
      }
      this.dstAirportUnit = nearestAirport;
      this.plane.setTargetUnit(this.dstAirportUnit);
      this.plane.touch();
      this.resetPath(ticks);
    }

    if (curTile === this.dstAirportUnit.tile()) {
      this.complete();
      return;
    }

    if (this.pathIndex >= this.currentPath.length) {
      this.resetPath(ticks);
      if (this.pathIndex >= this.currentPath.length) {
        this.complete();
        return;
      }
    }

    const nextTile = this.currentPath[this.pathIndex++];
    if (nextTile !== curTile) {
      this.plane.move(nextTile);
      this.tilesTraveled++;
    }
  }

  private resetPath(ticks: number): void {
    if (this.plane === undefined) {
      return;
    }

    const from = this.plane.tile();
    const dst = this.dstAirportUnit.tile();
    const fullPath = this.buildDirectPath(from, dst);
    const movementPath = this.speedAdjustedPath(fullPath);

    // movement path excludes current tile
    this.currentPath = movementPath.slice(1);
    this.pathIndex = 0;

    if (dst !== this.motionPlanDst) {
      this.motionPlanId++;
      this.game.recordMotionPlan({
        kind: "grid",
        unitId: this.plane.id(),
        planId: this.motionPlanId,
        startTick: ticks + 1,
        ticksPerStep: 1,
        // Keep replay path aligned with actual per-tick movement speed.
        path: movementPath,
      });
      this.motionPlanDst = dst;
    }
  }

  private speedAdjustedPath(path: TileRef[]): TileRef[] {
    if (path.length <= 2 || PlaneExecution.TILES_PER_TICK <= 1) {
      return path;
    }

    const accelerated: TileRef[] = [path[0]];
    const stride = PlaneExecution.TILES_PER_TICK;

    for (let i = stride; i < path.length; i += stride) {
      accelerated.push(path[i]);
    }

    const dst = path[path.length - 1];
    if (accelerated[accelerated.length - 1] !== dst) {
      accelerated.push(dst);
    }

    return accelerated;
  }

  private buildDirectPath(from: TileRef, to: TileRef): TileRef[] {
    if (from === to) {
      return [from];
    }

    const fromX = this.game.x(from);
    const fromY = this.game.y(from);
    const toX = this.game.x(to);
    const toY = this.game.y(to);
    const dx = toX - fromX;
    const dy = toY - fromY;
    const sx = Math.sign(dx);
    const sy = Math.sign(dy);
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    type MoveChunk = { dx: number; dy: number; steps: number };
    type Candidate = {
      chunks: MoveChunk[];
      turns: number;
      firstLegSteps: number;
      finalLegSteps: number;
      path: TileRef[];
    };

    const diagSteps = Math.min(absDx, absDy);
    const horizontalSteps = absDx - diagSteps;
    const verticalSteps = absDy - diagSteps;

    const baseChunks: MoveChunk[] = [];
    if (diagSteps > 0) {
      baseChunks.push({ dx: sx, dy: sy, steps: diagSteps });
    }
    if (horizontalSteps > 0) {
      baseChunks.push({ dx: sx, dy: 0, steps: horizontalSteps });
    }
    if (verticalSteps > 0) {
      baseChunks.push({ dx: 0, dy: sy, steps: verticalSteps });
    }

    const perms = this.permutations(baseChunks);
    const candidates: Candidate[] = [];

    for (const chunks of perms) {
      const turns = this.countChunkTurns(chunks);
      if (turns > PlaneExecution.MAX_TURNS) {
        continue;
      }

      const path = this.pathFromChunks(fromX, fromY, chunks);
      if (path.length === 0 || path[path.length - 1] !== to) {
        continue;
      }

      candidates.push({
        chunks,
        turns,
        firstLegSteps: chunks[0]?.steps ?? 0,
        finalLegSteps: chunks[chunks.length - 1]?.steps ?? 0,
        path,
      });
    }

    if (candidates.length === 0) {
      return this.buildDdaPath(from, to);
    }

    candidates.sort((a, b) => {
      if (a.turns !== b.turns) {
        return a.turns - b.turns;
      }
      // Prefer entering a long stable heading soon.
      if (a.firstLegSteps !== b.firstLegSteps) {
        return a.firstLegSteps - b.firstLegSteps;
      }
      if (a.finalLegSteps !== b.finalLegSteps) {
        return b.finalLegSteps - a.finalLegSteps;
      }
      if (a.path.length !== b.path.length) {
        return a.path.length - b.path.length;
      }

      // Final deterministic tie-breaker.
      for (let i = 0; i < Math.min(a.chunks.length, b.chunks.length); i++) {
        const ad = a.chunks[i].dx * 10 + a.chunks[i].dy;
        const bd = b.chunks[i].dx * 10 + b.chunks[i].dy;
        if (ad !== bd) {
          return ad - bd;
        }
      }
      return 0;
    });

    return candidates[0].path;
  }

  private permutations<T>(arr: T[]): T[][] {
    if (arr.length <= 1) {
      return [arr.slice()];
    }

    const out: T[][] = [];
    const used = new Array<boolean>(arr.length).fill(false);
    const cur: T[] = [];

    const dfs = (): void => {
      if (cur.length === arr.length) {
        out.push(cur.slice());
        return;
      }
      for (let i = 0; i < arr.length; i++) {
        if (used[i]) continue;
        used[i] = true;
        cur.push(arr[i]);
        dfs();
        cur.pop();
        used[i] = false;
      }
    };

    dfs();
    return out;
  }

  private countChunkTurns(
    chunks: ReadonlyArray<{ dx: number; dy: number; steps: number }>,
  ): number {
    let turns = 0;
    let prevDx = 0;
    let prevDy = 0;

    for (const chunk of chunks) {
      if (chunk.steps <= 0) {
        continue;
      }
      if (prevDx !== 0 || prevDy !== 0) {
        if (chunk.dx !== prevDx || chunk.dy !== prevDy) {
          turns++;
        }
      }
      prevDx = chunk.dx;
      prevDy = chunk.dy;
    }

    return turns;
  }

  private pathFromChunks(
    fromX: number,
    fromY: number,
    chunks: ReadonlyArray<{ dx: number; dy: number; steps: number }>,
  ): TileRef[] {
    let x = fromX;
    let y = fromY;
    const refs: TileRef[] = [this.game.ref(x, y)];

    for (const chunk of chunks) {
      for (let i = 0; i < chunk.steps; i++) {
        x += chunk.dx;
        y += chunk.dy;
        if (!this.game.isValidCoord(x, y)) {
          return [];
        }
        refs.push(this.game.ref(x, y));
      }
    }

    return refs;
  }

  private buildDdaPath(from: TileRef, to: TileRef): TileRef[] {
    const fromX = this.game.x(from);
    const fromY = this.game.y(from);
    const toX = this.game.x(to);
    const toY = this.game.y(to);
    const dx = toX - fromX;
    const dy = toY - fromY;
    const steps = Math.max(Math.abs(dx), Math.abs(dy));

    const refs: TileRef[] = [];
    let lastRef: TileRef | null = null;

    for (let step = 0; step <= steps; step++) {
      const x = Math.round(fromX + (dx * step) / steps);
      const y = Math.round(fromY + (dy * step) / steps);
      if (!this.game.isValidCoord(x, y)) {
        continue;
      }
      const ref = this.game.ref(x, y);
      if (ref !== lastRef) {
        refs.push(ref);
        lastRef = ref;
      }
    }

    if (refs.length === 0 || refs[0] !== from) {
      refs.unshift(from);
    }
    if (refs[refs.length - 1] !== to) {
      refs.push(to);
    }

    return refs;
  }

  private complete(): void {
    this.active = false;
    this.plane!.delete(false);
    const gold = this.game
      .config()
      .planeTradeGold(this.tilesTraveled, this.plane!.owner());

    if (this.wasCaptured) {
      this.plane!.owner().addGold(gold, this.dstAirportUnit.tile());
      this.game.displayMessage(
        "events_display.received_gold_from_captured_ship",
        MessageType.CAPTURED_ENEMY_UNIT,
        this.plane!.owner().id(),
        gold,
        {
          gold: renderNumber(gold),
          name: this.origOwner.displayName(),
        },
      );
      this.game
        .stats()
        .boatCapturedTrade(this.plane!.owner(), this.origOwner, gold);
    } else {
      this.srcAirport.owner().addGold(gold, this.srcAirport.tile());
      this.dstAirportUnit.owner().addGold(gold, this.dstAirportUnit.tile());
      this.game
        .stats()
        .boatArriveTrade(this.srcAirport.owner(), this.dstAirportUnit.owner(), gold);
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
