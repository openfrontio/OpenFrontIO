import type { EventBus } from "../../../core/EventBus";
import { UnitType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import type { GameView } from "../../../core/game/GameView";
import { ToggleStructureEvent } from "../../InputHandler";
import { TransformHandler } from "../TransformHandler";
import { UIState } from "../UIState";
import { Layer } from "./Layer";

const TILE_KEY_SHIFT = 16;
const TILE_KEY_MASK = 0xffff;

const encodeTileKey = (x: number, y: number): number =>
  ((x & TILE_KEY_MASK) << TILE_KEY_SHIFT) | (y & TILE_KEY_MASK);

type CachedSam = {
  id: number;
  owner: number;
  x: number;
  y: number;
  radius: number;
};

/**
 * Layer responsible for rendering SAM launcher defense radiuses for the local player.
 * Uses an offscreen canvas and cached metadata to minimize per-frame work.
 */
export class SAMRadiusLayer implements Layer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly samLaunchers: Map<number, CachedSam> = new Map();
  private readonly samStacksByTile: Map<number, CachedSam[]> = new Map();
  private cachedSamCircles: CachedSam[] = [];
  private needsRedraw = true;
  // track whether the stroke should be shown due to hover or due to an active build ghost
  private hoveredShow: boolean = false;
  private ghostShow: boolean = false;
  private showStroke: boolean = false;
  private dashOffset = 0;
  private rotationSpeed = 14; // px per second
  private lastTickTime = Date.now();
  private myPlayerSmallId: number | undefined;
  private samCachesDirty = true;

  private handleToggleStructure(e: ToggleStructureEvent) {
    const types = e.structureTypes;
    this.hoveredShow = !!types && types.indexOf(UnitType.SAMLauncher) !== -1;
    this.updateStrokeVisibility();
  }

  /**
   * Creates a SAM radius layer tied to the provided game view and UI state.
   * @param game reactive game view reference
   * @param eventBus global event bus for UI events
   * @param transformHandler helper for camera transformations
   * @param uiState shared UI state controlling toggle visibility
   */
  constructor(
    private readonly game: GameView,
    private readonly eventBus: EventBus,
    private readonly transformHandler: TransformHandler,
    private readonly uiState: UIState,
  ) {
    this.canvas = document.createElement("canvas");
    const ctx = this.canvas.getContext("2d");
    if (!ctx) {
      throw new Error("2d context not supported");
    }
    this.context = ctx;
    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();
  }

  /** Initializes event listeners and builds the initial SAM caches. */
  init() {
    // Listen for game updates to detect SAM launcher changes
    // Also listen for UI toggle structure events so we can show borders when
    // the user is hovering the Atom/Hydrogen option (UnitDisplay emits
    // ToggleStructureEvent with SAMLauncher included in the list).
    this.eventBus.on(ToggleStructureEvent, (e) =>
      this.handleToggleStructure(e),
    );
    this.syncMyPlayerSmallId();
    this.ensureSamCaches();
    this.redraw();
  }

  private updateStrokeVisibility() {
    const next = this.hoveredShow || this.ghostShow;
    if (next !== this.showStroke) {
      this.showStroke = next;
      this.needsRedraw = true;
    }
  }

  shouldTransform(): boolean {
    return true;
  }

  /**
   * Runs every frame to keep cached SAM data aligned with the game state and animate
   * dashed stroke offsets when coverage is visible.
   */
  tick() {
    // Check for updates to SAM launchers
    const updates = this.game.updatesSinceLastTick();
    const unitUpdates = updates?.[GameUpdateType.Unit];

    this.syncMyPlayerSmallId();

    if (unitUpdates) {
      for (const update of unitUpdates) {
        const unit = this.game.unit(update.id);
        const cached = this.samLaunchers.get(update.id);

        if (unit && unit.type() === UnitType.SAMLauncher) {
          const ownerSmallId = unit.owner().smallID();
          if (ownerSmallId === this.myPlayerSmallId) {
            this.samCachesDirty = true;
            this.needsRedraw = true;
            break;
          }
          if (cached) {
            this.samCachesDirty = true;
            this.needsRedraw = true;
            break;
          }
        } else if (!unit && cached) {
          this.samCachesDirty = true;
          this.needsRedraw = true;
          break;
        }
      }
    }

    // show when in ghost mode for sam/atom/hydrogen
    this.ghostShow =
      this.uiState.ghostStructure === UnitType.SAMLauncher ||
      this.uiState.ghostStructure === UnitType.AtomBomb ||
      this.uiState.ghostStructure === UnitType.HydrogenBomb;
    this.updateStrokeVisibility();

    // Redraw if transform changed or if we need to redraw
    const now = Date.now();
    const dt = now - this.lastTickTime;
    this.lastTickTime = now;

    if (this.showStroke) {
      this.dashOffset += (this.rotationSpeed * dt) / 1000;
      if (this.dashOffset > 1e6) this.dashOffset = this.dashOffset % 1000000;
      // animate by redrawing each frame whilst visible
      this.needsRedraw = true;
    }

    if (this.transformHandler.hasChanged() || this.needsRedraw) {
      this.redraw();
      this.needsRedraw = false;
    }
  }

  renderLayer(context: CanvasRenderingContext2D) {
    context.drawImage(
      this.canvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
  }

  /** Redraws the offscreen canvas using the latest cached SAM circles. */
  redraw() {
    // Clear the canvas
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const mySmallId = this.syncMyPlayerSmallId();
    if (mySmallId === undefined) {
      return;
    }

    this.ensureSamCaches();

    this.drawCirclesUnion(
      this.cachedSamCircles.map(({ id: _id, radius: r, ...rest }) => ({
        ...rest,
        r,
      })),
    );
  }

  /** Rebuilds cached SAM metadata when the dirty flag is set. */
  private ensureSamCaches() {
    if (!this.samCachesDirty) {
      return;
    }
    this.rebuildSamCaches();
    this.samCachesDirty = false;
  }

  /** Recomputes per-tile SAM stacks and flattened circles for the current player. */
  private rebuildSamCaches() {
    this.samStacksByTile.clear();
    this.cachedSamCircles = [];
    this.samLaunchers.clear();

    const mySmallId = this.myPlayerSmallId;
    if (mySmallId === undefined) {
      return;
    }

    const config = this.game.config();

    const samLaunchers = this.game
      .units(UnitType.SAMLauncher)
      .filter(
        (unit) => unit.isActive() && unit.owner().smallID() === mySmallId,
      );

    for (const sam of samLaunchers) {
      const tile = sam.tile();
      const x = this.game.x(tile);
      const y = this.game.y(tile);
      const cached: CachedSam = {
        id: sam.id(),
        owner: mySmallId,
        x,
        y,
        radius: config.samRange(sam.level()),
      };

      this.cachedSamCircles.push(cached);
      this.samLaunchers.set(sam.id(), cached);

      const key = encodeTileKey(x, y);
      const stack = this.samStacksByTile.get(key);
      if (stack) {
        stack.push(cached);
      } else {
        this.samStacksByTile.set(key, [cached]);
      }
    }
  }

  /** Keeps cached SAM data aligned with the current player's small ID. */
  private syncMyPlayerSmallId(): number | undefined {
    const current = this.game.myPlayer()?.smallID();
    if (current !== this.myPlayerSmallId) {
      this.myPlayerSmallId = current;
      this.samCachesDirty = true;
      if (current === undefined) {
        this.samStacksByTile.clear();
        this.cachedSamCircles = [];
        this.samLaunchers.clear();
      }
    }
    return this.myPlayerSmallId;
  }

  /**
   * Draws the union of cached SAM circles, optionally outlining exposed outer arcs.
   * @param circles flattened list of circle descriptors
   */
  private drawCirclesUnion(
    circles: Array<{ x: number; y: number; r: number; owner: number }>,
  ) {
    const ctx = this.context;
    if (circles.length === 0) return;

    // styles
    const strokeStyleOuter = "rgba(0, 0, 0, 1)";

    // 1) Fill union simply by drawing all full circle paths and filling once
    ctx.save();
    ctx.beginPath();
    for (const c of circles) {
      ctx.moveTo(c.x + c.r, c.y);
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    }
    ctx.restore();

    // 2) For stroke, compute for each circle which angular segments are NOT covered by any other circle,
    //    and stroke only those segments. This produces a union outline without overlapping inner strokes.
    // Only draw the stroke when UI toggle indicates SAM launchers are focused (e.g. hovering Atom/Hydrogen option).
    if (!this.showStroke) return;

    ctx.save();
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 6]);
    ctx.lineDashOffset = this.dashOffset;
    ctx.strokeStyle = strokeStyleOuter;

    const TWO_PI = Math.PI * 2;

    // helper functions
    const normalize = (a: number) => {
      while (a < 0) a += TWO_PI;
      while (a >= TWO_PI) a -= TWO_PI;
      return a;
    };

    // merge a list of intervals [s,e] (both between 0..2pi), taking wraparound into account
    const mergeIntervals = (
      intervals: Array<[number, number]>,
    ): Array<[number, number]> => {
      if (intervals.length === 0) return [];
      // normalize to non-wrap intervals
      const flat: Array<[number, number]> = [];
      for (const [s, e] of intervals) {
        const ns = normalize(s);
        const ne = normalize(e);
        if (ne < ns) {
          // wraps, split
          flat.push([ns, TWO_PI]);
          flat.push([0, ne]);
        } else {
          flat.push([ns, ne]);
        }
      }
      flat.sort((a, b) => a[0] - b[0]);
      const merged: Array<[number, number]> = [];
      let cur = flat[0].slice() as [number, number];
      for (let i = 1; i < flat.length; i++) {
        const it = flat[i];
        if (it[0] <= cur[1] + 1e-9) {
          cur[1] = Math.max(cur[1], it[1]);
        } else {
          merged.push([cur[0], cur[1]]);
          cur = it.slice() as [number, number];
        }
      }
      merged.push([cur[0], cur[1]]);
      return merged;
    };

    for (let i = 0; i < circles.length; i++) {
      const a = circles[i];
      // collect intervals on circle a that are covered by other circles
      const covered: Array<[number, number]> = [];
      let fullyCovered = false;

      for (let j = 0; j < circles.length; j++) {
        if (i === j) continue;
        // Only consider coverage from circles owned by the same player.
        // This shows separate boundaries for different players' SAM coverage,
        // making contested areas visually distinct.
        if (a.owner !== circles[j].owner) continue;
        const b = circles[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d + a.r <= b.r + 1e-9) {
          // circle a is fully inside b
          fullyCovered = true;
          break;
        }
        if (d >= a.r + b.r - 1e-9) {
          // no overlap
          continue;
        }
        if (d <= 1e-9) {
          // coincident centers but not fully covered (should be covered by previous check if radii differ)
          if (b.r >= a.r) {
            fullyCovered = true;
            break;
          }
          continue;
        }

        // compute angular span on circle a that is inside circle b
        const theta = Math.atan2(dy, dx);
        // law of cosines for angle between center-line and intersection points
        const cosPhi = (a.r * a.r + d * d - b.r * b.r) / (2 * a.r * d);
        // numerical clamp
        const clamp = Math.max(-1, Math.min(1, cosPhi));
        const phi = Math.acos(clamp);
        const start = theta - phi;
        const end = theta + phi;
        covered.push([start, end]);
      }

      if (fullyCovered) continue; // nothing to stroke for this circle

      const merged = mergeIntervals(covered);

      // subtract merged covered intervals from [0,2pi) to get uncovered intervals
      const uncovered: Array<[number, number]> = [];
      if (merged.length === 0) {
        uncovered.push([0, TWO_PI]);
      } else {
        let cursor = 0;
        for (const [s, e] of merged) {
          if (s > cursor + 1e-9) {
            uncovered.push([cursor, s]);
          }
          cursor = Math.max(cursor, e);
        }
        if (cursor < TWO_PI - 1e-9) uncovered.push([cursor, TWO_PI]);
      }

      // draw uncovered arcs
      for (const [s, e] of uncovered) {
        // skip tiny arcs
        if (e - s < 1e-3) continue;
        ctx.beginPath();
        ctx.arc(a.x, a.y, a.r, s, e);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}
