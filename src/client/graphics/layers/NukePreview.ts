import { Cell, UnitType } from "../../../core/game/Game";
import type { GameView } from "../../../core/game/GameView";
import { NukeType } from "../../../core/StatsSchemas";
import type { TransformHandler } from "../TransformHandler";
import type { UIState } from "../UIState";
import type { Layer } from "./Layer";

export const isNukeType = (t: UnitType) =>
  t === UnitType.AtomBomb || t === UnitType.HydrogenBomb || t === UnitType.MIRV;

/**
 * Renders a deterministic preview for single-blast nukes and MIRV scatter.
 */
export class NukePreview implements Layer {
  constructor(
    private game: GameView,
    private transform: TransformHandler,
    private ui: UIState,
    private _npSig = "",
    private _npSeed = 0,
    private _mirvTargets: Array<{ x: number; y: number; w: number }> = [],
    private _mirvSig = "",
  ) {}

  init() {}
  tick() {}
  shouldTransform(): boolean {
    return false;
  }

  // 32-bit deterministic hash
  private h32 = (x: number): number => {
    x ^= x >>> 16;
    x = Math.imul(x, 0x7feb352d);
    x ^= x >>> 15;
    x = Math.imul(x, 0x846ca68b);
    x ^= x >>> 16;
    return x >>> 0;
  };

  private rand01 = (x: number, y: number, seed: number): number =>
    (this.h32(this.h32(x) ^ this.h32(y) ^ seed) & 0xffff) / 0x10000;

  renderLayer(ctx: CanvasRenderingContext2D): void {
    const p = this.ui.nukePreview;
    const anchor = this.ui.nukeAnchor;
    if (!p?.active || !anchor) return;

    // Stable seed per (type, anchor)
    const sig = `${p.nukeType}|${anchor.x}|${anchor.y}`;
    if (this._npSig !== sig) {
      this._npSig = sig;
      this._npSeed = this.game.ticks();
    }
    const seed = this._npSeed;

    if (p.nukeType === "MIRV") {
      this.renderMirvPreview(ctx, anchor.x, anchor.y, seed);
      return;
    }

    this.renderSingleBlastPreview(ctx, anchor.x, anchor.y, p.nukeType as NukeType, seed);
  }

  // ---------- Single-blast (Atom/Hydrogen) ----------

  private renderSingleBlastPreview(
    ctx: CanvasRenderingContext2D,
    ax: number,
    ay: number,
    nukeType: NukeType,
    seed: number,
  ): void {
    const { inner, outer } = this.game.config().nukeMagnitudes(nukeType);
    const s = this.transform.scale;

    const rect = this.transform.boundingRect();
    const topLeftPx = this.transform.worldToScreenCoordinates(new Cell(ax, ay));
    const cx = topLeftPx.x - rect.left + s * 0.5;
    const cy = topLeftPx.y - rect.top + s * 0.5;

    const rInnerPx = inner * s;
    const rOuterPx = outer * s;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.imageSmoothingEnabled = false;

    // Inner circle stroke + fill
    this.drawCircle(ctx, cx, cy, rInnerPx, {
      strokeWidth: 2,
      stroke: "rgba(220, 20, 60, 0.65)",
      fill: "rgba(220, 20, 60, 0.30)",
    });

    // Probabilistic band between inner and outer radii
    const outer2 = outer * outer;
    const inner2 = inner * inner;
    const tileStep = Math.max(1, Math.floor(2 / Math.max(0.5, s)));
    ctx.fillStyle = "rgba(220, 20, 60, 0.14)";

    for (let dy = -outer; dy <= outer; dy += tileStep) {
      const wy = ay + dy;
      for (let dx = -outer; dx <= outer; dx += tileStep) {
        const wx = ax + dx;
        const d2 = dx * dx + dy * dy;
        if (d2 > outer2) continue;

        // Fill if inside inner or by probability
        if (d2 <= inner2 || this.rand01(wx, wy, seed) < 0.5) {
          const pt = this.transform.worldToScreenCoordinates(new Cell(wx, wy));
          const px = pt.x - rect.left;
          const py = pt.y - rect.top;
          const size = s * tileStep;
          ctx.fillRect(px, py, size, size);
        }
      }
    }

    // Static safety line just inside the outer radius
    const halfTilePx = s * tileStep * 0.5;
    const visualPad = Math.max(halfTilePx + 1, 3);
    const rOuterVisual = Math.max(rInnerPx + 2, rOuterPx - visualPad);
    this.strokeCircle(ctx, cx, cy, rOuterVisual, 1, "rgba(220,20,60,0.35)");

    ctx.restore();
  }

  // ---------- MIRV scatter preview ----------

  private renderMirvPreview(
    ctx: CanvasRenderingContext2D,
    ax: number,
    ay: number,
    seed: number,
  ): void {
    const s = this.transform.scale;
    const rect = this.transform.boundingRect();

    // Warhead magnitudes
    const wh = this.game.config().nukeMagnitudes(UnitType.MIRVWarhead);
    const rInnerPx = wh.inner * s;
    const rOuterPx = wh.outer * s;

    // MIRV parameters
    const MIRV_RANGE = 1500; // tiles
    const MIN_SPACING = 25; // Manhattan distance
    const PREVIEW_COUNT = 100; // count for perf/clarity

    const anchorOwner = this.game.owner(this.game.ref(ax, ay));

    // Recompute candidate targets when signature changes
    const sig =
      `MIRV|${ax}|${ay}|${anchorOwner.isPlayer() ? (anchorOwner as any).id() : "TN"}`;
    if (this._mirvSig !== sig) {
      this._mirvSig = sig;
      this._mirvTargets = [];

      let attempts = 0;
      const MAX_ATTEMPTS = 15000;

      while (this._mirvTargets.length < PREVIEW_COUNT && attempts < MAX_ATTEMPTS) {
        attempts++;

        // Uniform sample in circle via polar with deterministic PRNG
        const r01 = (this.h32(seed ^ attempts) & 0xffff) / 0x10000;
        const t01 = (this.h32(seed ^ (attempts * 2654435761)) & 0xffff) / 0x10000;

        const r = Math.sqrt(r01) * MIRV_RANGE;
        const theta = t01 * Math.PI * 2;

        const dx = Math.round(r * Math.cos(theta));
        const dy = Math.round(r * Math.sin(theta));
        const tx = ax + dx;
        const ty = ay + dy;

        if (!this.game.isValidCoord(tx, ty)) continue;

        const tile = this.game.ref(tx, ty);
        if (!this.game.isLand(tile)) continue;

        const owner = this.game.owner(tile);
        if (owner !== anchorOwner) continue;

        // Enforce minimum Manhattan spacing
        let tooClose = false;
        for (const t of this._mirvTargets) {
          if (Math.abs(t.x - tx) + Math.abs(t.y - ty) < MIN_SPACING) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;

        const w = this.h32((tx & 0xffff) ^ ((ty & 0xffff) << 16) ^ seed);
        this._mirvTargets.push({ x: tx, y: ty, w });
      }
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";

    for (const { x, y, w } of this._mirvTargets) {
      const pt = this.transform.worldToScreenCoordinates(new Cell(x, y));
      let cx = pt.x - rect.left + s * 0.5;
      let cy = pt.y - rect.top + s * 0.5;

      // Sub-tile jitter for visual variety
      cx += ((w & 0xff) / 255 - 0.5) * (s * 0.45);
      cy += (((w >> 8) & 0xff) / 255 - 0.5) * (s * 0.45);

      // Inner circle stroke + fill
      this.drawCircle(ctx, cx, cy, rInnerPx, {
        strokeWidth: 1,
        stroke: "rgba(220, 20, 60, 0.7)",
        fill: "rgba(220, 20, 60, 0.22)",
      });

      // Static outer boundary hint
      this.strokeCircle(
        ctx,
        cx,
        cy,
        Math.max(rInnerPx + 2, rOuterPx - 1),
        1,
        "rgba(220, 20, 60, 0.35)",
      );
    }

    ctx.restore();
  }

  // ---------- Drawing helpers ----------

  private drawCircle(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    opts: { strokeWidth: number; stroke: string; fill: string },
  ): void {
    ctx.beginPath();
    ctx.setLineDash([]);
    ctx.lineWidth = opts.strokeWidth;
    ctx.strokeStyle = opts.stroke;
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.fillStyle = opts.fill;
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  private strokeCircle(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    width: number,
    color: string,
  ): void {
    ctx.beginPath();
    ctx.setLineDash([]);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}
