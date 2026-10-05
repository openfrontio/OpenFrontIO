import { html, svg, TemplateResult } from "lit";

// The pieces the full-screen progression moments are built from: the prestige
// ceremony (PrestigeFlow) and the Legend ceremony (LegendCeremony). The menu
// background at full strength, the honeycomb traced over its own hex lines
// and lit in waves, a flash, a shockwave and the title slam. Each ceremony
// colours them (the honeycomb's `--hx-color`, the flash's `--flash-bg`, the
// shockwave's `--shock-color`) and adds its own beats on top.

// The honeycomb baked into the menu background (resources/images/
// background.webp, 2500x1382): flat-topped hexes with 147px sides, one of
// whose rows of horizontal edges runs along y=1260 with an edge centred on
// x=144. Measured from the image, so traced hexes sit on its own lines when
// drawn over it at the same scale and position (cover, centred). `d` is each
// hex's distance from the focus point (the middle across, `focusY` of the way
// down), 0..1, for the waves.
export interface Honeycomb {
  width: number;
  height: number;
  hexes: { points: string; d: number }[];
}

const honeycombs = new Map<number, Honeycomb>();

export function honeycomb(focusY = 0.5): Honeycomb {
  const cached = honeycombs.get(focusY);
  if (cached !== undefined) return cached;
  const width = 2500;
  const height = 1382;
  const side = 147;
  const halfHeight = (Math.sqrt(3) * side) / 2;
  const originX = 144;
  const originY = 1260 - halfHeight;
  const hexes: { points: string; d: number }[] = [];
  const maxDist = Math.hypot(width / 2, height / 2);
  for (let col = -2; col <= Math.ceil(width / (1.5 * side)) + 1; col++) {
    const cx = originX + col * 1.5 * side;
    const shift = col % 2 === 0 ? 0 : halfHeight;
    for (let row = -2; row <= Math.ceil(height / (2 * halfHeight)) + 2; row++) {
      const cy = originY - shift - row * 2 * halfHeight;
      if (cx < -side || cx > width + side) continue;
      if (cy < -halfHeight * 2 || cy > height + halfHeight * 2) continue;
      const points = [0, 60, 120, 180, 240, 300]
        .map((deg) => {
          const a = (deg * Math.PI) / 180;
          return `${(cx + side * Math.cos(a)).toFixed(1)},${(cy + side * Math.sin(a)).toFixed(1)}`;
        })
        .join(" ");
      const d = Math.min(
        1,
        Math.hypot(cx - width / 2, cy - height * focusY) / maxDist,
      );
      hexes.push({ points, d: Number(d.toFixed(3)) });
    }
  }
  const comb = { width, height, hexes };
  honeycombs.set(focusY, comb);
  return comb;
}

/**
 * The honeycomb, full screen, in `mode` (a class naming its waves: the
 * prestige ceremony's hx-charge / hx-burst / hx-idle, or the Legend
 * ceremony's own). Coloured by `--hx-color` on it or an ancestor.
 */
export function renderHoneycomb(
  mode: string,
  opts: { focusY?: number; className?: string } = {},
): TemplateResult {
  const comb = honeycomb(opts.focusY);
  return html`<svg
    aria-hidden="true"
    class="ceremony-honeycomb ${opts.className ?? ""} ${mode}"
    viewBox="0 0 ${comb.width} ${comb.height}"
    preserveAspectRatio="xMidYMid slice"
  >
    ${comb.hexes.map(
      (hex) =>
        svg`<polygon
          class="hx"
          points=${hex.points}
          style="--d: ${hex.d}"
        ></polygon>`,
    )}
  </svg>`;
}

// Re-exported for the ceremonies, which take their helpers from here.
export { prefersReducedMotion } from "../utilities/ReducedMotion";

const STYLE_ID = "ceremony-styles";

// Once per document, in <head>: the `@property` registrations only work from
// a document stylesheet, and every ceremony shares these.
export function ensureCeremonyStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CEREMONY_CSS;
  document.head.appendChild(style);
}

const CEREMONY_CSS = /* css */ `
/* The prestige hold's charge, 0..1 while held (1..1.75 as the emblem keeps
   charging into the ceremony). Registered so it can transition and animate. */
@property --hold {
  syntax: "<number>";
  inherits: true;
  initial-value: 0;
}
/* The menu background, as it sits behind every page, but at full strength:
   the moment has the whole screen to itself. */
.ceremony-backdrop {
  background-color: #070d18;
  background-image: var(--background-image-url);
  background-size: cover;
  background-position: center;
  filter: brightness(0.7);
  animation: ceremony-fade-in 400ms ease-out both;
}
/* Darker in the middle and at the edges, so the badge and the words read
   over the map. */
.ceremony-vignette {
  background: radial-gradient(
    ellipse at 50% 45%,
    rgba(3, 6, 12, 0.55) 0%,
    rgba(3, 6, 12, 0.15) 45%,
    rgba(3, 6, 12, 0.75) 100%
  );
  animation: ceremony-fade-in 400ms ease-out both;
}
.ceremony-honeycomb {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  filter: drop-shadow(0 0 6px var(--hx-glow, var(--hx-color, #00c8ff)));
}
.ceremony-honeycomb .hx {
  fill: none;
  stroke: var(--hx-color, #00c8ff);
  stroke-width: 9;
  stroke-linejoin: round;
  opacity: 0;
}
/* Inward: the outermost hexes light first, the wave closing on the badge,
   over and over while it charges. */
.hx-charge .hx {
  animation: hx-pulse 1100ms ease-in-out infinite;
  animation-delay: calc((1 - var(--d)) * 900ms);
}
@keyframes hx-pulse {
  0%,
  100% {
    opacity: 0;
  }
  35% {
    opacity: 0.85;
  }
}
/* Outward: one burst from the badge to the edges of the screen. */
.hx-burst .hx {
  animation: hx-burst 1500ms ease-out both;
  animation-delay: calc(var(--d) * 700ms);
}
@keyframes hx-burst {
  0% {
    opacity: 0;
    stroke: #ffffff;
  }
  12% {
    opacity: 1;
    stroke: #ffffff;
  }
  40% {
    opacity: 0.9;
    stroke: var(--hx-color, #00c8ff);
  }
  100% {
    opacity: 0.12;
    stroke: var(--hx-color, #00c8ff);
  }
}
/* At rest: a slow shimmer rolling outward. */
.hx-idle .hx {
  animation: hx-idle 4s ease-in-out infinite;
  animation-delay: calc(var(--d) * 2s);
}
@keyframes hx-idle {
  0%,
  100% {
    opacity: 0.08;
  }
  50% {
    opacity: 0.45;
  }
}
.ceremony-flash {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: var(--flash-bg, #ffffff);
  animation: ceremony-flash var(--flash-ms, 700ms) ease-out both;
}
@keyframes ceremony-flash {
  0% {
    opacity: 0.95;
  }
  100% {
    opacity: 0;
  }
}
.ceremony-shockwave {
  position: absolute;
  top: 50%;
  left: 50%;
  width: var(--shock-size, 200px);
  height: var(--shock-size, 200px);
  margin: calc(var(--shock-size, 200px) / -2) 0 0
    calc(var(--shock-size, 200px) / -2);
  border-radius: 9999px;
  border: var(--shock-width, 6px) solid var(--shock-color, var(--tier));
  box-shadow: 0 0 30px var(--shock-color, var(--tier));
  pointer-events: none;
  animation: ceremony-shockwave var(--shock-ms, 800ms) ease-out
    var(--shock-delay, 0ms) both;
}
@keyframes ceremony-shockwave {
  from {
    transform: scale(var(--shock-from, 0.6));
    opacity: 1;
  }
  to {
    transform: scale(var(--shock-to, 3.2));
    opacity: 0;
  }
}
.ceremony-slam {
  animation: ceremony-slam 520ms cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
}
@keyframes ceremony-slam {
  0% {
    opacity: 0;
    transform: scale(2.6) skewX(-8deg);
  }
  55% {
    opacity: 1;
    transform: scale(0.94) skewX(-8deg);
  }
  100% {
    transform: none;
  }
}
@keyframes ceremony-fade-in {
  from {
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .hx-charge .hx,
  .hx-burst .hx,
  .hx-idle .hx,
  .ceremony-slam,
  .ceremony-shockwave {
    animation: none;
  }
}
`;
