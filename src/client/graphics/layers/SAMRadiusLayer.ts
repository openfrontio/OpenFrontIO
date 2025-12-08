import type { EventBus } from "../../../core/EventBus";
import { UnitType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import type { GameView, PlayerView } from "../../../core/game/GameView";
import { ToggleStructureEvent } from "../../InputHandler";
import { TransformHandler } from "../TransformHandler";
import { UIState } from "../UIState";
import { Layer } from "./Layer";

/**
 * Layer responsible for rendering SAM launcher defense radii
 */
export class SAMRadiusLayer implements Layer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly samLaunchers: Map<number, number> = new Map(); // Track SAM launcher IDs -> ownerSmallID
  private needsRedraw = true;
  // track whether the stroke should be shown due to hover or due to an active build ghost
  private hoveredShow: boolean = false;
  private ghostShow: boolean = false;
  private showStroke: boolean = false;
  private dashOffset = 0;
  private rotationSpeed = 14; // px per second
  private lastTickTime = Date.now();

  private handleToggleStructure(e: ToggleStructureEvent) {
    const types = e.structureTypes;
    this.hoveredShow = !!types && types.indexOf(UnitType.SAMLauncher) !== -1;
    this.updateStrokeVisibility();
  }

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

  init() {
    // Listen for game updates to detect SAM launcher changes
    // Also listen for UI toggle structure events so we can show borders when
    // the user is hovering the Atom/Hydrogen option (UnitDisplay emits
    // ToggleStructureEvent with SAMLauncher included in the list).
    this.eventBus.on(ToggleStructureEvent, (e) =>
      this.handleToggleStructure(e),
    );
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

  tick() {
    // Check for updates to SAM launchers
    const updates = this.game.updatesSinceLastTick();
    const unitUpdates = updates?.[GameUpdateType.Unit];

    if (unitUpdates) {
      let hasChanges = false;

      for (const update of unitUpdates) {
        const unit = this.game.unit(update.id);
        if (unit && unit.type() === UnitType.SAMLauncher) {
          const wasTracked = this.samLaunchers.has(update.id);
          const shouldTrack = unit.isActive();
          const owner = unit.owner().smallID();

          if (wasTracked && !shouldTrack) {
            // SAM was destroyed
            this.samLaunchers.delete(update.id);
            hasChanges = true;
          } else if (!wasTracked && shouldTrack) {
            // New SAM was built
            this.samLaunchers.set(update.id, owner);
            hasChanges = true;
          } else if (wasTracked && shouldTrack) {
            // SAM still exists; check if owner changed
            const prevOwner = this.samLaunchers.get(update.id);
            if (prevOwner !== owner) {
              this.samLaunchers.set(update.id, owner);
              hasChanges = true;
            }
          }
        }
      }

      if (hasChanges) {
        this.needsRedraw = true;
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

  redraw() {
    // Clear the canvas
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Get all active SAM launchers
    const samLaunchers = this.game
      .units(UnitType.SAMLauncher)
      .filter((unit) => unit.isActive());

    // Update our tracking set
    this.samLaunchers.clear();
    samLaunchers.forEach((sam) =>
      this.samLaunchers.set(sam.id(), sam.owner().smallID()),
    );

    // Draw union of SAM radii. Collect circle data then draw union outer arcs only
    const circles = samLaunchers.map((sam) => {
      const tile = sam.tile();
      return {
        x: this.game.x(tile),
        y: this.game.y(tile),
        r: this.game.config().samRange(sam.level()),
        owner: sam.owner(),
      };
    });

    this.drawCirclesUnion(circles);
  }

  /**
   * Draw union of multiple circles: fill the union, then stroke only the outer arcs
   * so overlapping circles appear as one combined shape.
   */
  private drawCirclesUnion(
    circles: Array<{ x: number; y: number; r: number; owner: PlayerView }>,
  ) {
    const ctx = this.context;
    if (circles.length === 0) return;

    // Line Parameters
    const outlineColor = "rgba(0, 0, 0, 1)";
    const lineColorSelf = "rgba(0, 255, 0, 1)";
    const lineColorEnemy = "rgba(255, 0, 0, 1)";
    const lineColorFriend = "rgba(255, 255, 0, 1)";
    const extraOutlineWidth = 1; // adds onto below
    const lineWidth = 2;
    const lineDash = [12, 6];

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
        if (a.owner.smallID() !== circles[j].owner.smallID()) continue;

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

        // Outline
        ctx.strokeStyle = outlineColor;
        ctx.lineWidth = lineWidth + extraOutlineWidth;
        ctx.setLineDash([
          lineDash[0] + extraOutlineWidth,
          Math.max(lineDash[1] - extraOutlineWidth, 0),
        ]);
        ctx.lineDashOffset = this.dashOffset + extraOutlineWidth / 2;
        ctx.stroke();
        // Inline
        if (a.owner.isMe()) {
          ctx.strokeStyle = lineColorSelf;
        } else if (this.game.myPlayer()?.isFriendly(a.owner)) {
          ctx.strokeStyle = lineColorFriend;
        } else {
          ctx.strokeStyle = lineColorEnemy;
        }
        ctx.lineWidth = lineWidth;
        ctx.setLineDash(lineDash);
        ctx.lineDashOffset = this.dashOffset;
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}
