import { Cell, UnitType } from "../../../core/game/Game";
import type { GameView } from "../../../core/game/GameView";
import { NukeType } from "../../../core/StatsSchemas";
import type { TransformHandler } from "../TransformHandler";
import type { UIState } from "../UIState";
import type { Layer } from "./Layer";

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

  // deterministic hash
  private h32 = (x: number) => {
    x ^= x >>> 16;
    x = Math.imul(x, 0x7feb352d);
    x ^= x >>> 15;
    x = Math.imul(x, 0x846ca68b);
    x ^= x >>> 16;
    return x >>> 0;
  };

  renderLayer(ctx: CanvasRenderingContext2D): void {
    const p = this.ui.nukePreview;
    const anchor = this.ui.nukeAnchor;
    if (!p?.active || !anchor) return;

    // seed stability per (type, anchor)
    const sig = `${p.nukeType}|${anchor.x}|${anchor.y}`;
    if (this._npSig !== sig) {
      this._npSig = sig;
      this._npSeed = this.game.ticks();
    }

    const seed = this._npSeed;

    // MIRV branch (scatter a bunch of mini-warheads)
    if (p.nukeType === "MIRV") {
      this.renderMirvPreview(ctx, anchor.x, anchor.y, seed);
      return;
    }

    // === existing single-blast code (atom/hydrogen) ===
    const { inner, outer } = this.game
      .config()
      .nukeMagnitudes(p.nukeType as NukeType);
    const s = this.transform.scale;
    const rInner = inner * s;
    const rOuter = outer * s;

    const rect = this.transform.boundingRect();
    const tl = this.transform.worldToScreenCoordinates(
      new Cell(anchor.x, anchor.y),
    );
    const cx = tl.x - rect.left + s * 0.5;
    const cy = tl.y - rect.top + s * 0.5;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.imageSmoothingEnabled = false;

    // inner ring + fill
    ctx.beginPath();
    ctx.setLineDash([]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(220, 20, 60, 0.65)";
    ctx.arc(cx, cy, rInner, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.fillStyle = "rgba(220, 20, 60, 0.30)";
    ctx.arc(cx, cy, rInner, 0, Math.PI * 2);
    ctx.fill();


    const rand01 = (x: number, y: number) =>
      (this.h32(this.h32(x) ^ this.h32(y) ^ seed) & 0xffff) / 0x10000;

    // probabilistic band
    const outer2 = outer * outer,
      inner2 = inner * inner;
    const tileStep = Math.max(1, Math.floor(2 / Math.max(0.5, s)));
    ctx.fillStyle = "rgba(220, 20, 60, 0.14)";

    for (let dy = -outer; dy <= outer; dy += tileStep) {
      const wy = anchor.y + dy;
      for (let dx = -outer; dx <= outer; dx += tileStep) {
        const wx = anchor.x + dx;
        const d2 = dx * dx + dy * dy;
        if (d2 > outer2) continue;
        if (d2 <= inner2 || rand01(wx, wy) < 0.5) {
          const pt = this.transform.worldToScreenCoordinates(new Cell(wx, wy));
          const px = pt.x - rect.left;
          const py = pt.y - rect.top;
          const size = s * tileStep;
          ctx.fillRect(px, py, size, size);
        }
      }
    }

    // safety line just inside real outer
    const halfTilePx = s * tileStep * 0.5;
    const visualPad = Math.max(halfTilePx + 1, 3);
    const rOuterVisual = Math.max(rInner + 2, rOuter - visualPad);
    ctx.beginPath();
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(220,20,60,0.35)";
    ctx.arc(cx, cy, rOuterVisual, 0, Math.PI * 2);
    ctx.stroke();

    // spinning rings outside the band
    const bandPx = Math.max(0, rOuter - rInner);
    const offsetOut = Math.max(4, Math.min(24, bandPx * 0.2));
    const sepOut = Math.max(6, Math.min(18, bandPx * 0.18));
    const rRing1 = rOuter + offsetOut;
    const rRing2 = rRing1 + sepOut;

    const dash = 12,
      gap = 10,
      speed = 15;
    const t = performance.now() / 1000;
    const cycle = dash + gap;
    const spin = (t * speed) % cycle;

    ctx.beginPath();
    ctx.setLineDash([dash, gap]);
    ctx.lineDashOffset = -spin;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(220, 20, 60, 0.95)";
    ctx.arc(cx, cy, rRing1, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.setLineDash([dash, gap]);
    ctx.lineDashOffset = spin;
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(220, 20, 60, 0.9)";
    ctx.arc(cx, cy, rRing2, 0, Math.PI * 2);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.restore();
  }

  private renderMirvPreview(
    ctx: CanvasRenderingContext2D,
    ax: number,
    ay: number,
    seed: number,
  ) {
    const s = this.transform.scale;
    const rect = this.transform.boundingRect();

    // Use the actual MIRV warhead magnitudes (no extra scaling)
    const wh = this.game.config().nukeMagnitudes(UnitType.MIRVWarhead);
    const rInnerPx = wh.inner * s;
    const rOuterPx = wh.outer * s;

    // Match MirvExecution.mirvRange exactly
    const MIRV_RANGE = 1500; // tiles
    const MIN_SPACING = 25; // tiles (Manhattan), like proximityCheck
    const PREVIEW_COUNT = 100; // draw ~100 for clarity/perf

    // Owner gate: preview only on tiles with the same owner as the anchor (player or TerraNullius)
    const anchorOwner = this.game.owner(this.game.ref(ax, ay));

    // Recompute targets only when signature changes
    const sig = `MIRV|${ax}|${ay}|${anchorOwner.isPlayer() ? (anchorOwner as any).id() : "TN"}`;
    if (this._mirvSig !== sig) {
      this._mirvSig = sig;
      this._mirvTargets = [];

      // We’ll pick PREVIEW_COUNT positions uniformly from the circle (radius 1500),
      // respecting owner/land and min spacing, with a bounded attempts budget.
      const range2 = MIRV_RANGE * MIRV_RANGE;
      let attempts = 0;
      const MAX_ATTEMPTS = 15000;

      while (
        this._mirvTargets.length < PREVIEW_COUNT &&
        attempts < MAX_ATTEMPTS
      ) {
        attempts++;

        // Uniform sample in circle via polar
        // Use a deterministic PRNG from seed + attempts
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
        // must match the same owner object (player or TerraNullius)
        if (owner !== anchorOwner) continue;

        // respect min Manhattan spacing among already selected targets
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

    // Spin/dash (tiny rings)
    const dash = 8,
      gap = 8,
      speed = 18;
    const time = performance.now() / 1000;
    const cycle = dash + gap;
    const spin = (time * speed) % cycle;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";

    for (const { x, y, w } of this._mirvTargets) {
      const pt = this.transform.worldToScreenCoordinates(new Cell(x, y));
      let cx = pt.x - rect.left + s * 0.5;
      let cy = pt.y - rect.top + s * 0.5;

      // slight intra-tile jitter so they don’t sit perfectly centered
      const jx = ((w & 0xff) / 255 - 0.5) * (s * 0.45);
      const jy = (((w >> 8) & 0xff) / 255 - 0.5) * (s * 0.45);
      cx += jx;
      cy += jy;

      // mini inner stroke + fill
      ctx.beginPath();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(220, 20, 60, 0.7)";
      ctx.arc(cx, cy, rInnerPx, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.fillStyle = "rgba(220, 20, 60, 0.22)";
      ctx.arc(cx, cy, rInnerPx, 0, Math.PI * 2);
      ctx.fill();

      // tiny spinning ring right outside inner
      ctx.beginPath();
      ctx.setLineDash([dash, gap]);
      ctx.lineDashOffset = w & 1 ? -spin : spin; // alternate direction for variety
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(220, 20, 60, 0.9)";
      ctx.arc(cx, cy, Math.max(rInnerPx + 2, rOuterPx - 1), 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.setLineDash([]);
    ctx.restore();
  }
}
