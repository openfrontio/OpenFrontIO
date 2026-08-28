/**
 * PreviewAnimationTicker — deterministic parametric simulation engine for cosmetic previews.
 *
 * Responsibilities:
 * 1. Simulates realistic unit trajectories (parabolic missile flights, boat patrols, MIRV cluster separation).
 * 2. Matches exact in-game flight speeds (10 tiles/s for nukes/boats, 15-22 tiles/s for MIRV/warheads).
 * 3. Drives single / 5-nuke salvo missile sequences and staggered sequential detonation events.
 * 4. Generates continuous trail histories, spiral ribbon geometry, and structure showcases.
 */

import {
  SAMPLE_FLOATS,
  type SpiralParams,
  type SpiralRibbon,
} from "../frame/SpiralTrails";
import { TrainType } from "../types";
import type { UnitState } from "../types/Renderer";
import {
  UT_ATOM_BOMB,
  UT_CITY,
  UT_DEFENSE_POST,
  UT_FACTORY,
  UT_HYDROGEN_BOMB,
  UT_MIRV,
  UT_MIRV_WARHEAD,
  UT_MISSILE_SILO,
  UT_PORT,
  UT_SAM_LAUNCHER,
  UT_TRAIN,
  UT_TRANSPORT,
  UT_WARSHIP,
} from "../types/UnitType";
import {
  getPreviewRailLoop,
  PREVIEW_MAP_DIM,
  PREVIEW_RAIL_STATIONS,
} from "./PreviewMapGenerator";

export type CosmeticPreviewMode =
  | "SKIN"
  | "BUILDING"
  | "WARSHIP_BOAT_TRAIL"
  | "NUKE_MISSILE_TRAIL"
  | "MIRV_CLUSTER"
  | "NUKE_EXPLOSION"
  | "TRAIN"
  | "RAILROAD";

export interface DetonationEvent {
  unitType: string;
  x: number;
  y: number;
}

export interface PreviewAnimationSnapshot {
  /** Mobile units, drawn by UnitPass. */
  units: UnitState[];
  /** Buildings, drawn by StructurePass. */
  structures?: UnitState[];
  spiralRibbons: SpiralRibbon[];
  trailPoints: Array<{
    x: number;
    y: number;
    isNuke: boolean;
    timestamp?: number;
  }>;
  detonationEvents: DetonationEvent[];
  isNewCycle?: boolean;
}

export interface PreviewAnimationConfig {
  mode: CosmeticPreviewMode;
  cosmeticUnitType?: string;
  structureLevel?: number;
  spiralParams?: SpiralParams | null;
  explosionDurationSec?: number;
  salvoMode?: boolean;
}

/** One simulated tick. `lastPos` trails `pos` by this much, as in a match. */
const TICK_SEC = 0.1;
const NUKE_FLIGHT_DURATION_SEC = 3.4;
const SALVO_COUNT = 5;
const SALVO_STAGGER_SEC = 0.1;
const MIRV_SEP_TIME_SEC = 2.0;
const MIRV_FLIGHT_DURATION_SEC = 3.8;
const BOAT_CYCLE_DURATION_SEC = 19.2;
// In-game train geometry: TrainExecution moves 2 tiles per tick with cars
// 2 tiles apart; TrainStationExecution runs 5 carriages between the engines.
const TRAIN_TILES_PER_SEC = 20;
const TRAIN_CAR_SPACING = 2;
const TRAIN_CARRIAGES = 5;

// 8 radial scatter targets centered cleanly within the archipelago view (radius 60-70 tiles)
export const MIRV_WARHEAD_TARGETS = [
  { x: 320, y: 256 }, // East
  { x: 301, y: 301 }, // South-East
  { x: 256, y: 320 }, // South
  { x: 211, y: 301 }, // South-West
  { x: 192, y: 256 }, // West
  { x: 211, y: 211 }, // North-West
  { x: 256, y: 192 }, // North
  { x: 301, y: 211 }, // North-East
];

export class PreviewAnimationTicker {
  private readonly ribbonBuffer = new Float32Array(512 * SAMPLE_FLOATS);
  private lastCycleIndex = -1;
  private detonatedWarheads = new Set<number>();
  private detonatedNukes = new Set<number>();

  constructor(
    private readonly config: PreviewAnimationConfig,
    private readonly startTime = performance.now(),
  ) {}

  private getNukeCycleDuration(): number {
    const expDur = this.config.explosionDurationSec ?? 3.5;
    const salvoExtra = this.config.salvoMode
      ? (SALVO_COUNT - 1) * SALVO_STAGGER_SEC
      : 0;
    return (
      NUKE_FLIGHT_DURATION_SEC +
      salvoExtra +
      Math.min(Math.max(expDur, 2.5), 12.0) +
      0.5
    );
  }

  private getMIRVCycleDuration(): number {
    const expDur = this.config.explosionDurationSec ?? 3.5;
    return (
      MIRV_FLIGHT_DURATION_SEC + Math.min(Math.max(expDur, 2.5), 12.0) + 0.5
    );
  }

  sample(now: number): PreviewAnimationSnapshot {
    const elapsed = Math.max(0, (now - this.startTime) / 1000);

    switch (this.config.mode) {
      case "SKIN":
        return this.sampleSkin();
      case "BUILDING":
        return this.sampleAllBuildings();
      case "WARSHIP_BOAT_TRAIL":
        return this.sampleWarship(elapsed % BOAT_CYCLE_DURATION_SEC);
      case "TRAIN":
      case "RAILROAD":
        return this.sampleTrain(elapsed);
      case "MIRV_CLUSTER": {
        const cycleDur = this.getMIRVCycleDuration();
        return this.sampleMIRV(
          elapsed % cycleDur,
          Math.floor(elapsed / cycleDur),
        );
      }
      case "NUKE_MISSILE_TRAIL":
      case "NUKE_EXPLOSION":
      default: {
        const cycleDur = this.getNukeCycleDuration();
        return this.sampleNuke(
          elapsed % cycleDur,
          Math.floor(elapsed / cycleDur),
        );
      }
    }
  }

  private sampleSkin(): PreviewAnimationSnapshot {
    const cityTile = 220 * PREVIEW_MAP_DIM + 204;
    const city = createBaseUnitState(1, UT_CITY, cityTile, cityTile);
    city.level = 1;
    city.underConstruction = false;

    return {
      units: [],
      structures: [city],
      spiralRibbons: [],
      trailPoints: [],
      detonationEvents: [],
    };
  }

  private sampleAllBuildings(): PreviewAnimationSnapshot {
    const buildingLayouts: Array<{
      type: string;
      x: number;
      y: number;
      level: number;
    }> = [
      { type: UT_PORT, x: 256, y: 256, level: 2 },
      { type: UT_CITY, x: 204, y: 220, level: 3 },
      { type: UT_FACTORY, x: 204, y: 292, level: 2 },
      { type: UT_DEFENSE_POST, x: 236, y: 200, level: 2 },
      { type: UT_SAM_LAUNCHER, x: 236, y: 312, level: 1 },
      { type: UT_MISSILE_SILO, x: 164, y: 256, level: 1 },
    ];

    const units: UnitState[] = buildingLayouts.map((b, idx) => {
      const tileRef = b.y * PREVIEW_MAP_DIM + b.x;
      const unit = createBaseUnitState(idx + 1, b.type, tileRef, tileRef);
      unit.level = b.level;
      unit.underConstruction = false;
      return unit;
    });

    return {
      units: [],
      structures: units,
      spiralRibbons: [],
      trailPoints: [],
      detonationEvents: [],
    };
  }

  /**
   * A 7-car train (engine, 5 loaded carriages, tail engine) circling the
   * preview rail loop between a city and a factory, at in-game speed and
   * spacing. Used for both the train and railroad cosmetics.
   */
  private sampleTrain(elapsed: number): PreviewAnimationSnapshot {
    const { path } = getPreviewRailLoop();
    const n = path.length;
    // The engine advances whole tiles, like TrainExecution.
    const head = Math.floor(elapsed * TRAIN_TILES_PER_SEC);
    const tilesPerTick = TRAIN_TILES_PER_SEC * TICK_SEC;
    const tileBehind = (offset: number) =>
      path[(((head - offset) % n) + n) % n];
    const car = (
      id: number,
      trainType: TrainType,
      offset: number,
      loaded: boolean | null,
    ): UnitState => {
      const unit = createBaseUnitState(
        id,
        UT_TRAIN,
        tileBehind(offset),
        tileBehind(offset + tilesPerTick),
      );
      unit.trainType = trainType;
      unit.loaded = loaded;
      return unit;
    };

    const units: UnitState[] = [car(1, TrainType.Engine, 0, null)];
    for (let i = 0; i < TRAIN_CARRIAGES; i++) {
      units.push(
        car(2 + i, TrainType.Carriage, (i + 1) * TRAIN_CAR_SPACING, true),
      );
    }
    units.push(
      car(
        2 + TRAIN_CARRIAGES,
        TrainType.TailEngine,
        (TRAIN_CARRIAGES + 1) * TRAIN_CAR_SPACING,
        null,
      ),
    );

    const station = (
      id: number,
      type: string,
      at: { x: number; y: number },
    ) => {
      const ref = at.y * PREVIEW_MAP_DIM + at.x;
      const unit = createBaseUnitState(id, type, ref, ref);
      unit.level = 2;
      unit.hasTrainStation = true;
      return unit;
    };

    return {
      units,
      structures: [
        station(100, UT_CITY, PREVIEW_RAIL_STATIONS.city),
        station(101, UT_FACTORY, PREVIEW_RAIL_STATIONS.factory),
      ],
      spiralRibbons: [],
      trailPoints: [],
      detonationEvents: [],
    };
  }

  private sampleWarship(time: number): PreviewAnimationSnapshot {
    const waypoints = [
      { x: 232, y: 232 },
      { x: 280, y: 232 },
      { x: 280, y: 280 },
      { x: 232, y: 280 },
    ];

    const segmentDuration = BOAT_CYCLE_DURATION_SEC / 4;
    const safeTime =
      ((time % BOAT_CYCLE_DURATION_SEC) + BOAT_CYCLE_DURATION_SEC) %
      BOAT_CYCLE_DURATION_SEC;
    const segIdx = Math.min(
      3,
      Math.max(0, Math.floor(safeTime / segmentDuration)),
    );
    const segT = (safeTime % segmentDuration) / segmentDuration;

    const from = waypoints[segIdx];
    const to = waypoints[(segIdx + 1) % 4];

    const currentX = from.x + (to.x - from.x) * segT;
    const currentY = from.y + (to.y - from.y) * segT;

    const prevT = Math.max(0, segT - TICK_SEC / segmentDuration);
    const prevX = from.x + (to.x - from.x) * prevT;
    const prevY = from.y + (to.y - from.y) * prevT;

    const pos = Math.floor(currentY) * PREVIEW_MAP_DIM + Math.floor(currentX);
    const lastPos = Math.floor(prevY) * PREVIEW_MAP_DIM + Math.floor(prevX);

    const unitType =
      this.config.cosmeticUnitType === UT_TRANSPORT ? UT_TRANSPORT : UT_WARSHIP;
    const ship = createBaseUnitState(1, unitType, pos, lastPos);

    const trailPoints: Array<{
      x: number;
      y: number;
      isNuke: boolean;
      timestamp?: number;
    }> = [];
    // Only transports leave a wake in-game (GameView TRAIL_TYPES); a warship
    // cosmetic recolors the hull, not a trail.
    if (unitType !== UT_TRANSPORT) {
      return {
        units: [ship],
        spiralRibbons: [],
        trailPoints,
        detonationEvents: [],
      };
    }
    let lastPt: { x: number; y: number } | null = null;
    const trailSteps = 100;
    const maxTrailSec = 8.0;

    for (let i = 0; i <= trailSteps; i++) {
      const pastTime =
        (((safeTime - (i / trailSteps) * maxTrailSec) %
          BOAT_CYCLE_DURATION_SEC) +
          BOAT_CYCLE_DURATION_SEC) %
        BOAT_CYCLE_DURATION_SEC;
      const pSegIdx = Math.min(
        3,
        Math.max(0, Math.floor(pastTime / segmentDuration)),
      );
      const pSegT = (pastTime % segmentDuration) / segmentDuration;
      const pFrom = waypoints[pSegIdx];
      const pTo = waypoints[(pSegIdx + 1) % 4];
      const curPt = {
        x: Math.round(pFrom.x + (pTo.x - pFrom.x) * pSegT),
        y: Math.round(pFrom.y + (pTo.y - pFrom.y) * pSegT),
      };
      const timestamp = Math.max(
        0,
        Math.floor((safeTime - (i / trailSteps) * maxTrailSec) * 10),
      );

      if (lastPt) {
        appendTrailSegment(lastPt, curPt, false, timestamp, trailPoints);
      } else {
        trailPoints.push({ x: curPt.x, y: curPt.y, isNuke: false, timestamp });
      }
      lastPt = curPt;
    }

    return {
      units: [ship],
      spiralRibbons: [],
      trailPoints,
      detonationEvents: [],
    };
  }

  private sampleNuke(time: number, cycleIdx: number): PreviewAnimationSnapshot {
    let isNewCycle = false;
    if (cycleIdx !== this.lastCycleIndex) {
      this.lastCycleIndex = cycleIdx;
      this.detonatedNukes.clear();
      isNewCycle = true;
    }

    const flightDuration = NUKE_FLIGHT_DURATION_SEC;
    const isSalvo = !!this.config.salvoMode;
    const salvoCount = isSalvo ? SALVO_COUNT : 1;
    const unitType =
      this.config.cosmeticUnitType === UT_ATOM_BOMB
        ? UT_ATOM_BOMB
        : UT_HYDROGEN_BOMB;

    // Centered trajectory landing in the center of the archipelago (260, 240)
    const p0 = { x: 100, y: 370 };
    const p1 = { x: 260, y: 240 };
    const arcHeight = 80;

    const units: UnitState[] = [];
    const detonationEvents: DetonationEvent[] = [];
    // Furthest tail head among in-flight nukes. Trails and ribbons are stamped
    // up to lastPos (one tick behind), like TrailManager/SpiralTrails in-game,
    // so they never lead the smoothed missile.
    let maxPrevT = 0;

    for (let i = 0; i < salvoCount; i++) {
      const launchTime = i * SALVO_STAGGER_SEC;
      const hitTime = flightDuration + launchTime;

      if (time >= launchTime && time < hitTime) {
        const flightTime = time - launchTime;
        const t = Math.min(1, flightTime / flightDuration);
        const prevT = Math.max(0, (flightTime - TICK_SEC) / flightDuration);
        maxPrevT = Math.max(maxPrevT, prevT);

        const x = p0.x + (p1.x - p0.x) * t;
        const y = p0.y + (p1.y - p0.y) * t - 4 * arcHeight * t * (1 - t);

        const prevX = p0.x + (p1.x - p0.x) * prevT;
        const prevY =
          p0.y + (p1.y - p0.y) * prevT - 4 * arcHeight * prevT * (1 - prevT);

        const pos = Math.floor(y) * PREVIEW_MAP_DIM + Math.floor(x);
        const lastPos = Math.floor(prevY) * PREVIEW_MAP_DIM + Math.floor(prevX);
        units.push(createBaseUnitState(1 + i, unitType, pos, lastPos));
      } else if (time >= hitTime) {
        if (!this.detonatedNukes.has(i)) {
          this.detonatedNukes.add(i);
          detonationEvents.push({ unitType, x: p1.x, y: p1.y });
        }
      }
    }

    const spiralRibbons: SpiralRibbon[] = [];
    if (units.length > 0 && maxPrevT > 0) {
      const ribbon = this.buildSpiralRibbon(1, maxPrevT, p0, p1, arcHeight);
      if (ribbon) spiralRibbons.push(ribbon);
    }

    // A trail lives exactly as long as its nuke: in-game TrailManager clears
    // the tiles the tick the unit dies, so nothing lingers under the explosion.
    const trailPoints: Array<{
      x: number;
      y: number;
      isNuke: boolean;
      timestamp?: number;
    }> = [];

    if (units.length > 0) {
      let lastPt: { x: number; y: number } | null = null;
      const steps = Math.floor(maxPrevT * 100);
      for (let s = 0; s <= steps; s++) {
        const u = s / 100;
        const curPt = {
          x: Math.round(p0.x + (p1.x - p0.x) * u),
          y: Math.round(p0.y + (p1.y - p0.y) * u - 4 * arcHeight * u * (1 - u)),
        };
        const timestamp = Math.floor(u * flightDuration * 10);
        if (lastPt) {
          appendTrailSegment(lastPt, curPt, true, timestamp, trailPoints);
        } else {
          trailPoints.push({ x: curPt.x, y: curPt.y, isNuke: true, timestamp });
        }
        lastPt = curPt;
      }
    }

    return {
      units,
      spiralRibbons,
      trailPoints,
      detonationEvents,
      isNewCycle,
    };
  }

  private sampleMIRV(time: number, cycleIdx: number): PreviewAnimationSnapshot {
    let isNewCycle = false;
    if (cycleIdx !== this.lastCycleIndex) {
      this.lastCycleIndex = cycleIdx;
      this.detonatedWarheads.clear();
      isNewCycle = true;
    }

    const sepTime = MIRV_SEP_TIME_SEC;
    const flightDuration = MIRV_FLIGHT_DURATION_SEC;
    const p0 = { x: 100, y: 370 };
    const pApex = { x: 220, y: 170 };

    if (time < sepTime) {
      return {
        ...this.sampleMIRVCarrier(time, sepTime, p0, pApex),
        isNewCycle,
      };
    }

    const maxDist = 154.2;
    const getHitTime = (tgt: { x: number; y: number }) => {
      const d = Math.hypot(tgt.x - pApex.x, tgt.y - pApex.y);
      return (
        sepTime + (flightDuration - sepTime) * (0.88 + 0.12 * (d / maxDist))
      );
    };

    const detonationEvents: DetonationEvent[] = [];
    for (let i = 0; i < MIRV_WARHEAD_TARGETS.length; i++) {
      const tgt = MIRV_WARHEAD_TARGETS[i];
      const hitTime = getHitTime(tgt);
      if (time >= hitTime && !this.detonatedWarheads.has(i)) {
        this.detonatedWarheads.add(i);
        detonationEvents.push({
          unitType: UT_MIRV_WARHEAD,
          x: tgt.x,
          y: tgt.y,
        });
      }
    }

    if (time < flightDuration) {
      const warheadSnap = this.sampleMIRVWarheads(
        time,
        sepTime,
        flightDuration,
        pApex,
        getHitTime,
      );
      return {
        ...warheadSnap,
        detonationEvents: [
          ...warheadSnap.detonationEvents,
          ...detonationEvents,
        ],
        isNewCycle,
      };
    }

    // All warheads have hit: their trails died with them, like in-game.
    return {
      units: [],
      spiralRibbons: [],
      trailPoints: [],
      detonationEvents,
      isNewCycle,
    };
  }

  private sampleMIRVCarrier(
    time: number,
    sepTime: number,
    p0: { x: number; y: number },
    pApex: { x: number; y: number },
  ): PreviewAnimationSnapshot {
    const t = Math.min(1, time / sepTime);
    const x = p0.x + (pApex.x - p0.x) * t;
    const arcHeight = 90;
    const y = p0.y + (pApex.y - p0.y) * t - 4 * arcHeight * t * (1 - t);

    const prevT = Math.max(0, (time - TICK_SEC) / sepTime);
    const prevX = p0.x + (pApex.x - p0.x) * prevT;
    const prevY =
      p0.y + (pApex.y - p0.y) * prevT - 4 * arcHeight * prevT * (1 - prevT);

    const pos = Math.floor(y) * PREVIEW_MAP_DIM + Math.floor(x);
    const lastPos = Math.floor(prevY) * PREVIEW_MAP_DIM + Math.floor(prevX);
    const carrier = createBaseUnitState(1, UT_MIRV, pos, lastPos);

    const trailPoints: Array<{
      x: number;
      y: number;
      isNuke: boolean;
      timestamp?: number;
    }> = [];
    let lastPt: { x: number; y: number } | null = null;
    const steps = Math.floor(prevT * 60);

    for (let s = 0; s <= steps; s++) {
      const u = s / 60;
      const curPt = {
        x: Math.round(p0.x + (pApex.x - p0.x) * u),
        y: Math.round(
          p0.y + (pApex.y - p0.y) * u - 4 * arcHeight * u * (1 - u),
        ),
      };
      const timestamp = Math.floor(u * sepTime * 10);
      if (lastPt) {
        appendTrailSegment(lastPt, curPt, true, timestamp, trailPoints);
      } else {
        trailPoints.push({ x: curPt.x, y: curPt.y, isNuke: true, timestamp });
      }
      lastPt = curPt;
    }

    return {
      units: [carrier],
      spiralRibbons: [],
      trailPoints,
      detonationEvents: [],
    };
  }

  private sampleMIRVWarheads(
    time: number,
    sepTime: number,
    flightDuration: number,
    pApex: { x: number; y: number },
    getHitTime: (tgt: { x: number; y: number }) => number,
  ): PreviewAnimationSnapshot {
    const units: UnitState[] = [];
    const trailPoints: Array<{
      x: number;
      y: number;
      isNuke: boolean;
      timestamp?: number;
    }> = [];

    for (let i = 0; i < MIRV_WARHEAD_TARGETS.length; i++) {
      const target = MIRV_WARHEAD_TARGETS[i];
      const hitTime = getHitTime(target);
      // A warhead that has hit is gone, and so is its trail (as in-game).
      if (time >= hitTime) continue;
      const t = Math.min(1, (time - sepTime) / (hitTime - sepTime));
      const prevT = Math.max(
        0,
        (time - TICK_SEC - sepTime) / (hitTime - sepTime),
      );

      const wx = pApex.x + (target.x - pApex.x) * t;
      const wy =
        pApex.y + (target.y - pApex.y) * t - 25 * Math.sin(t * Math.PI);

      const prevWx = pApex.x + (target.x - pApex.x) * prevT;
      const prevWy =
        pApex.y + (target.y - pApex.y) * prevT - 25 * Math.sin(prevT * Math.PI);

      const wPos = Math.floor(wy) * PREVIEW_MAP_DIM + Math.floor(wx);
      const wLastPos =
        Math.floor(prevWy) * PREVIEW_MAP_DIM + Math.floor(prevWx);

      units.push(createBaseUnitState(100 + i, UT_MIRV_WARHEAD, wPos, wLastPos));

      let lastPt: { x: number; y: number } | null = null;
      const steps = Math.floor(prevT * 60);
      for (let s = 0; s <= steps; s++) {
        const u = s / 60;
        const curPt = {
          x: Math.round(pApex.x + (target.x - pApex.x) * u),
          y: Math.round(
            pApex.y + (target.y - pApex.y) * u - 25 * Math.sin(u * Math.PI),
          ),
        };
        const timestamp = Math.floor(
          sepTime * 10 + u * (flightDuration - sepTime) * 10,
        );
        if (lastPt) {
          appendTrailSegment(lastPt, curPt, true, timestamp, trailPoints);
        } else {
          trailPoints.push({
            x: curPt.x,
            y: curPt.y,
            isNuke: true,
            timestamp,
          });
        }
        lastPt = curPt;
      }
    }

    return {
      units,
      spiralRibbons: [],
      trailPoints,
      detonationEvents: [],
    };
  }

  private buildSpiralRibbon(
    id: number,
    progress: number,
    p0: { x: number; y: number },
    p1: { x: number; y: number },
    arcH: number,
  ): SpiralRibbon | null {
    const params = this.config.spiralParams;
    if (!params) return null;

    const sampleCount = Math.max(2, Math.floor(progress * 180));
    let cumulativeDist = 0;
    let lastX = p0.x;
    let lastY = p0.y;

    for (let i = 0; i < sampleCount; i++) {
      const u = i / 180;
      const cx = p0.x + (p1.x - p0.x) * u;
      const cy = p0.y + (p1.y - p0.y) * u - 4 * arcH * u * (1 - u);
      const segDist = Math.hypot(cx - lastX, cy - lastY);
      cumulativeDist += segDist;

      const idx = i * SAMPLE_FLOATS;
      this.ribbonBuffer[idx] = cx;
      this.ribbonBuffer[idx + 1] = cy;
      this.ribbonBuffer[idx + 2] = -(cy - lastY) / (segDist || 1);
      this.ribbonBuffer[idx + 3] = (cx - lastX) / (segDist || 1);
      this.ribbonBuffer[idx + 4] = cumulativeDist;

      lastX = cx;
      lastY = cy;
    }

    const pitch = Math.max(params.radius * 4, 8);
    return {
      id,
      radius: params.radius,
      strands: params.strands,
      twist: (2 * Math.PI) / pitch,
      rotationSpeed: params.rotationSpeed,
      colors: params.colors,
      headDist: cumulativeDist,
      sampleCount,
      samples: this.ribbonBuffer,
    };
  }
}

function bresenhamLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  plot: (x: number, y: number) => void,
): void {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let cx = x0;
  let cy = y0;

  for (;;) {
    plot(cx, cy);
    if (cx === x1 && cy === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      cx += sx;
    }
    if (e2 <= dx) {
      err += dx;
      cy += sy;
    }
  }
}

/**
 * Appends rasterized line segments into the trail points array using Bresenham algorithm.
 */
function appendTrailSegment(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  isNuke: boolean,
  timestamp: number,
  out: Array<{ x: number; y: number; isNuke: boolean; timestamp?: number }>,
): void {
  bresenhamLine(p0.x, p0.y, p1.x, p1.y, (bx, by) => {
    out.push({ x: bx, y: by, isNuke, timestamp });
  });
}

function createBaseUnitState(
  id: number,
  unitType: string,
  pos: number,
  lastPos: number,
): UnitState {
  return {
    id,
    unitType,
    ownerID: 1,
    lastOwnerID: null,
    pos,
    lastPos,
    isActive: true,
    reachedTarget: false,
    retreating: false,
    targetable: true,
    waitTicks: 0,
    markedForDeletion: false,
    health: null,
    underConstruction: false,
    targetUnitId: null,
    targetTile: null,
    troops: 10,
    missileTimerQueue: [],
    level: 1,
    veterancy: 0,
    hasTrainStation: false,
    trainType: null,
    loaded: null,
    constructionStartTick: null,
    samUpgradeStartTick: null,
    samUpgradeStartRange: null,
    samUpgradeTargetLevel: null,
    samUpgradeDuration: null,
  };
}
