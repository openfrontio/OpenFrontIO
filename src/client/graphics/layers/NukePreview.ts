import type { GameView } from "../../../core/game/GameView";
import type { TransformHandler } from "../TransformHandler";
import type { UIState } from "../UIState";
import type { Layer } from "./Layer";

import { Cell } from "../../../core/game/Game";
import { NukeType } from "../../../core/StatsSchemas";

export class NukePreview implements Layer {
  constructor(
    private game: GameView,
    private transform: TransformHandler,
    private ui: UIState,
    private _npSig = "",
    private _npSeed = 0,
  ) {}

  init() {}
  tick() {}
  shouldTransform(): boolean {
    return false;
  } // SCREEN SPACE

  renderLayer(ctx: CanvasRenderingContext2D): void {
    const p = this.ui.nukePreview;
    const anchor = this.ui.nukeAnchorScreen;
    if (!p?.active || p.nukeType === "MIRV" || !anchor) return;

    const { inner, outer } = this.game
      .config()
      .nukeMagnitudes(p.nukeType as NukeType);
    const s = this.transform.scale;
    const rInner = inner * s;
    const rOuter = outer * s;

    const rect = this.transform.boundingRect();
    const cx = anchor.x - rect.left;
    const cy = anchor.y - rect.top;

    // freeze a deterministic seed per (type, anchor) so the band doesn't flicker
    const sig = `${p.nukeType}|${anchor.x}|${anchor.y}`;
    if (this._npSig !== sig) {
      this._npSig = sig;
      this._npSeed = this.game.ticks();
    }
    const seed: number = this._npSeed;

    // screen-space drawing (identity)
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.imageSmoothingEnabled = false;

    // inner: solid stroke + soft fill (guaranteed)
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

    //  Accurate probabilistic band (≈ rand.chance(2))
    const centerCell = this.transform.screenToWorldCoordinates(
      anchor.x,
      anchor.y,
    );

    const h32 = (x: number) => {
      x ^= x >>> 16;
      x = Math.imul(x, 0x7feb352d);
      x ^= x >>> 15;
      x = Math.imul(x, 0x846ca68b);
      x ^= x >>> 16;
      return x >>> 0;
    };
    const rand01 = (x: number, y: number) =>
      (h32(h32(x) ^ h32(y) ^ seed) & 0xffff) / 0x10000;

    const outer2 = outer * outer;
    const inner2 = inner * inner;

    // adaptive sampling to keep perf sane when zoomed out
    const tileStep = Math.max(1, Math.floor(2 / Math.max(0.5, s))); // 1..4
    ctx.fillStyle = "rgba(220, 20, 60, 0.14)";

    for (let dy = -outer; dy <= outer; dy += tileStep) {
      const y = centerCell.y + dy;
      for (let dx = -outer; dx <= outer; dx += tileStep) {
        const x = centerCell.x + dx;
        const d2 = dx * dx + dy * dy;
        if (d2 > outer2) continue;
        if (d2 <= inner2 || rand01(x, y) < 0.5) {
          const tl = this.transform.worldToScreenCoordinates(new Cell(x, y));
          const px = tl.x - rect.left;
          const py = tl.y - rect.top;
          const size = s * tileStep;
          ctx.fillRect(px, py, size, size);
        }
      }
    }

    // compute a visual-safe outer radius so rings never sit outside the band
    const halfTilePx = s * tileStep * 0.5;
    const visualPad = Math.max(halfTilePx + 1, 3); // half tile + 1px safety
    const rOuterVisual = Math.max(rInner + 2, rOuter - visualPad);

    // faint true visual boundary (at the clamped extent)
    ctx.beginPath();
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(220,20,60,0.35)";
    ctx.arc(cx, cy, rOuterVisual, 0, Math.PI * 2);
    ctx.stroke();

    // Spinning dashed rings (OUTSIDE the shaded band)
    const bandPx = Math.max(0, rOuter - rInner);

    // how far OUTSIDE the true outer edge the first ring sits
    // small blasts → small offset; large blasts → slightly larger
    const offsetOut = Math.max(4, Math.min(24, bandPx * 0.2)); // 4..24 px past rOuter

    // separation between the two outside rings
    const sepOut = Math.max(6, Math.min(18, bandPx * 0.18)); // 6..18 px apart

    // actual radii
    const rRing1 = rOuter + offsetOut;
    const rRing2 = rRing1 + sepOut;

    // dash pattern + spin
    const dash = 12,
      gap = 10,
      speedPxPerSec = 15;
    const t = performance.now() / 1000;
    const cycle = dash + gap;
    const spin = (t * speedPxPerSec) % cycle;

    // ring 1 (clockwise)
    ctx.beginPath();
    ctx.setLineDash([dash, gap]);
    ctx.lineDashOffset = -spin;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(220, 20, 60, 0.95)";
    ctx.arc(cx, cy, rRing1, 0, Math.PI * 2);
    ctx.stroke();

    // ring 2 (counter-clockwise)
    ctx.beginPath();
    ctx.setLineDash([dash, gap]);
    ctx.lineDashOffset = spin;
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(220, 20, 60, 0.9)";
    ctx.arc(cx, cy, rRing2, 0, Math.PI * 2);
    ctx.stroke();

    // cleanup
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}
