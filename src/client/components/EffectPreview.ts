import { html, LitElement, TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import {
  NukeExplosionAttributes,
  StructuresEffectAttributes,
  TrailEffectAttributes,
} from "../../core/CosmeticSchemas";

// Neutral fallback when a trail has no usable colors.
const EMPTY_BG = "#444";

/**
 * Swatch preview of a trail-styled effect (trails and the structures effect
 * share the same gradient/transition attribute shapes), filling its container.
 *
 * - gradient / single color: a static swatch (flat color or left-to-right
 *   gradient — a multi-color list reads as a rainbow).
 * - transition: cross-fades through the colors over time, mirroring the trail
 *   (each color step lasts 1/frequency seconds, matching the shader).
 */
@customElement("trail-swatch")
export class TrailSwatch extends LitElement {
  // Named `trail` (not `attributes`) to avoid clashing with Element.attributes.
  @property({ attribute: false })
  trail: TrailEffectAttributes | StructuresEffectAttributes | null = null;

  private animation: Animation | null = null;

  // Light DOM so the shared Tailwind classes apply.
  createRenderRoot(): HTMLElement {
    return this;
  }

  render(): TemplateResult {
    const colors = this.trail?.colors ?? [];
    let background: string;
    if (colors.length === 0) {
      background = EMPTY_BG;
    } else if (this.trail?.type === "transition") {
      // The animation (see updated) cross-fades from here through the list.
      background = colors[0];
    } else if (colors.length === 1) {
      background = colors[0];
    } else {
      background = `linear-gradient(90deg,${colors.join(",")})`;
    }
    return html`<div
      class="w-full h-full rounded-md"
      style="background:${background};"
    ></div>`;
  }

  updated(changed: Map<string, unknown>): void {
    if (!changed.has("trail")) return;
    this.animation?.cancel();
    this.animation = null;

    const attrs = this.trail;
    if (attrs?.type !== "transition") return;
    const colors = attrs.colors;
    if (colors.length < 2 || attrs.frequency <= 0) return;

    const fill = this.querySelector<HTMLElement>("div");
    if (!fill) return;

    // Cross-fade color0 → color1 → … → color0; each step lasts 1/frequency s,
    // matching the shader's i = floor(uTime * frequency) mod count.
    const keyframes = [...colors, colors[0]].map((c) => ({
      backgroundColor: c,
    }));
    this.animation = fill.animate(keyframes, {
      duration: (colors.length / attrs.frequency) * 1000,
      iterations: Infinity,
      easing: "linear",
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.animation?.cancel();
    this.animation = null;
  }
}

// Fallback ring color when a shockwave has no usable colors (matches the
// renderer's default purple).
const DEFAULT_RING_COLOR = "#9919ff";

/**
 * Preview of a nuke-explosion shockwave: a ring expanding from the center and
 * fading out, looping. Mirrors the in-game semantics — loop duration is
 * size / speed (clamped watchable), border thickness follows thickness/size,
 * and the color cycles through the palette at transitionSpeed steps/s
 * (negative = reverse).
 */
@customElement("shockwave-swatch")
export class ShockwaveSwatch extends LitElement {
  @property({ attribute: false })
  explosion: NukeExplosionAttributes | null = null;

  private animations: Animation[] = [];

  // Light DOM so the shared Tailwind classes apply.
  createRenderRoot(): HTMLElement {
    return this;
  }

  render(): TemplateResult {
    return html`<div
      class="w-full h-full flex items-center justify-center overflow-hidden"
    >
      <div data-ring class="rounded-full" style="width:85%;height:85%;"></div>
    </div>`;
  }

  updated(changed: Map<string, unknown>): void {
    if (!changed.has("explosion")) return;
    for (const a of this.animations) a.cancel();
    this.animations = [];

    const attrs = this.explosion;
    const ring = this.querySelector<HTMLElement>("[data-ring]");
    if (!attrs || !ring) return;
    const colors =
      attrs.colors.length > 0 ? attrs.colors : [DEFAULT_RING_COLOR];

    // Border thickness ∝ thickness/size, measured against the tile; a
    // thickness ≥ size/2 renders as a filled disc, like in game.
    const d = ring.clientWidth || 100;
    const ratio = attrs.size > 0 ? attrs.thickness / attrs.size : 0.1;
    const px = Math.min(Math.max(ratio * d, 2), d / 2);
    ring.style.borderStyle = "solid";
    ring.style.borderWidth = `${px}px`;
    ring.style.borderColor = colors[0];

    // Expansion + fade, looping at the in-game pace (size / speed seconds),
    // clamped so extreme catalog values still read as an explosion.
    const durS = Math.min(
      Math.max(attrs.size / Math.max(attrs.speed, 0.001), 0.6),
      3,
    );
    this.animations.push(
      ring.animate(
        [
          { transform: "scale(0.1)", opacity: 1 },
          { transform: "scale(1)", opacity: 0 },
        ],
        { duration: durS * 1000, iterations: Infinity, easing: "linear" },
      ),
    );

    // Palette cycle at transitionSpeed steps/s (one full cycle =
    // count / |transitionSpeed| s); 0 or a single color stays static.
    if (colors.length >= 2 && attrs.transitionSpeed !== 0) {
      const list = attrs.transitionSpeed > 0 ? colors : [...colors].reverse();
      this.animations.push(
        ring.animate(
          [...list, list[0]].map((c) => ({ borderColor: c })),
          {
            duration: (colors.length / Math.abs(attrs.transitionSpeed)) * 1000,
            iterations: Infinity,
            easing: "linear",
          },
        ),
      );
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    for (const a of this.animations) a.cancel();
    this.animations = [];
  }
}

// Deterministic 0..1 from an index (shader-style hash) so dot positions are
// stable across re-renders without storing state. The fixed offsets below
// (101/211/307) decouple the position/twinkle/size hashes from the dot count.
function dotRand(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Preview of a nuke-explosion sparkles burst: a firework — dots start at the
 * center and ride outward (the whole burst scales up, mirroring the in-game
 * front-normalized anchoring), twinkling on the way and fading at the end of
 * the loop. Loop duration is size / speed (clamped watchable), dot count
 * follows density, dot size follows thickness/size, and each dot takes a
 * palette color by index; the colors cycle at transitionSpeed steps/s
 * (negative = reverse), like in game.
 */
@customElement("sparkles-swatch")
export class SparklesSwatch extends LitElement {
  @property({ attribute: false })
  explosion: NukeExplosionAttributes | null = null;

  private animations: Animation[] = [];

  // Light DOM so the shared Tailwind classes apply.
  createRenderRoot(): HTMLElement {
    return this;
  }

  // Dot count follows the cosmetic's density (≈ total glints in the burst),
  // clamped to keep the DOM preview cheap.
  private dotCount(): number {
    const attrs = this.explosion;
    const density = attrs?.type === "sparkles" ? attrs.density : 10;
    return Math.round(Math.min(Math.max(density, 4), 40));
  }

  render(): TemplateResult {
    // Dots are positioned on a uniform disc (sqrt for area-uniformity) at
    // deterministic hashed angles, as a fraction of the container.
    return html`<div data-box class="relative w-full h-full overflow-hidden">
      ${Array.from({ length: this.dotCount() }, (_, i) => {
        const ang = dotRand(i) * 2 * Math.PI;
        const dist = Math.sqrt(dotRand(i + 101)) * 42; // % of box
        const left = 50 + Math.cos(ang) * dist;
        const top = 50 + Math.sin(ang) * dist;
        return html`<div
          data-dot
          class="absolute rounded-full"
          style="left:${left}%;top:${top}%;transform:translate(-50%,-50%);opacity:0;"
        ></div>`;
      })}
    </div>`;
  }

  updated(changed: Map<string, unknown>): void {
    if (!changed.has("explosion")) return;
    for (const a of this.animations) a.cancel();
    this.animations = [];

    const attrs = this.explosion;
    const box = this.querySelector<HTMLElement>("[data-box]");
    if (!attrs || !box) return;
    const dots = this.querySelectorAll<HTMLElement>("[data-dot]");
    if (dots.length === 0) return;
    const colors =
      attrs.colors.length > 0 ? attrs.colors : [DEFAULT_RING_COLOR];

    // Average dot size ∝ thickness/size, measured against the tile, like the
    // ring's border thickness; each dot varies ±50% around it, like in game.
    const d = box.clientWidth || 100;
    const ratio = attrs.size > 0 ? attrs.thickness / attrs.size : 0.05;
    const px = Math.min(Math.max(ratio * d, 3), d / 4);

    // One loop = the in-game pace (size / speed seconds), clamped watchable.
    const durS = Math.min(
      Math.max(attrs.size / Math.max(attrs.speed, 0.001), 0.6),
      3,
    );

    // The whole burst expands from the center — dots keep their layout
    // positions and the container scales up, so each dot rides outward
    // radially (matching the shader's front-normalized anchoring) — and
    // everything fades together at the end of the loop.
    this.animations.push(
      box.animate(
        [
          { transform: "scale(0.05)", opacity: 1, offset: 0 },
          { transform: "scale(1)", opacity: 1, offset: 0.75 },
          { transform: "scale(1)", opacity: 0, offset: 1 },
        ],
        { duration: durS * 1000, iterations: Infinity, easing: "linear" },
      ),
    );

    dots.forEach((dot, i) => {
      const dotPx = px * (0.5 + dotRand(i + 307));
      dot.style.width = `${dotPx}px`;
      dot.style.height = `${dotPx}px`;
      dot.style.backgroundColor = colors[i % colors.length];

      // Continuous twinkle on a hashed phase, independent of the loop. Kept
      // shallow — in game the glints stay opaque and twinkle in brightness.
      this.animations.push(
        dot.animate([{ opacity: 1 }, { opacity: 0.65 }, { opacity: 1 }], {
          duration: (0.5 + dotRand(i + 211) * 0.6) * 1000,
          iterations: Infinity,
          easing: "ease-in-out",
        }),
      );

      // Palette cycle at transitionSpeed steps/s, rotated by the dot's own
      // palette index (mirroring the shader's per-glint offset).
      if (colors.length >= 2 && attrs.transitionSpeed !== 0) {
        const list = attrs.transitionSpeed > 0 ? colors : [...colors].reverse();
        const start = i % list.length;
        const rotated = [...list.slice(start), ...list.slice(0, start)];
        this.animations.push(
          dot.animate(
            [...rotated, rotated[0]].map((c) => ({ backgroundColor: c })),
            {
              duration:
                (colors.length / Math.abs(attrs.transitionSpeed)) * 1000,
              iterations: Infinity,
              easing: "linear",
            },
          ),
        );
      }
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    for (const a of this.animations) a.cancel();
    this.animations = [];
  }
}
