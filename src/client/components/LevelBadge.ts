import { html, LitElement, nothing, svg, SVGTemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import {
  clampPrestige,
  levelBand,
  MAX_LEVEL,
  PrestigeTier,
  prestigeTier,
} from "../Progression";
import { translateText } from "../Utils";

// A player's level as a small emblem: the number inside a frame whose SHAPE
// (not just colour, for colour-blind players) changes every ten levels, a
// prestige emblem around it once they have prestiged (itself a different
// shape per rank group, see prestigeTier), and its own look for Legend.
//
// Drawn on a 32x32 grid so it scales from the 16px nav badge up to the profile
// header without separate art.

interface BandStyle {
  // Frame outline on the 32x32 grid.
  shape: SVGTemplateResult;
  // Vertical centre of the number within the frame.
  textY: number;
  // Shrinks the number for frames with less interior room.
  fontScale: number;
  // For frames that are narrow where the number sits: two-digit numbers are
  // condensed to this width instead of being shrunk, so they stay tall.
  twoDigitWidth?: number;
  // Tailwind fill/stroke classes (kept literal so the class scanner sees them).
  colors: string;
}

function starPoints(
  points: number,
  outer: number,
  inner: number,
  rotationDeg = -90,
  cy = 16,
): string {
  const out: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = ((rotationDeg + (i * 180) / points) * Math.PI) / 180;
    out.push(
      `${(16 + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`,
    );
  }
  return out.join(" ");
}

const CROWN = "M2 9 L9 15 L16 4 L23 15 L30 9 L27 29 H5 Z";

// Index = levelBand(level): 1–9, 10–19, … 90–99, then 100.
const BANDS: readonly BandStyle[] = [
  // 1–9: circle
  {
    shape: svg`<circle cx="16" cy="16" r="14.5"></circle>`,
    textY: 16.5,
    fontScale: 1,
    colors: "fill-slate-600 stroke-slate-300",
  },
  // 10–19: rounded square
  {
    shape: svg`<rect x="2.5" y="2.5" width="27" height="27" rx="6"></rect>`,
    textY: 16.5,
    fontScale: 1,
    colors: "fill-emerald-700 stroke-emerald-300",
  },
  // 20–29: diamond
  {
    shape: svg`<polygon points="16,0.5 31.5,16 16,31.5 0.5,16"></polygon>`,
    textY: 16.5,
    fontScale: 0.95,
    twoDigitWidth: 15,
    colors: "fill-teal-700 stroke-teal-300",
  },
  // 30–39: shield
  {
    shape: svg`<path
      d="M3.5 2.5 H28.5 V15 C28.5 23 22.5 28 16 31 C9.5 28 3.5 23 3.5 15 Z"
    ></path>`,
    textY: 15,
    fontScale: 0.95,
    colors: "fill-sky-700 stroke-sky-300",
  },
  // 40–49: hexagon
  {
    shape: svg`<polygon
      points="16,1.5 29,9 29,23 16,30.5 3,23 3,9"
    ></polygon>`,
    textY: 16.5,
    fontScale: 0.95,
    colors: "fill-blue-700 stroke-blue-300",
  },
  // 50–59: octagon
  {
    shape: svg`<polygon
      points="10.5,2 21.5,2 30,10.5 30,21.5 21.5,30 10.5,30 2,21.5 2,10.5"
    ></polygon>`,
    textY: 16.5,
    fontScale: 1,
    colors: "fill-indigo-700 stroke-indigo-300",
  },
  // 60–69: banner with a notched tail
  {
    shape: svg`<path d="M3.5 2 H28.5 V30.5 L16 24 L3.5 30.5 Z"></path>`,
    textY: 13.5,
    fontScale: 0.95,
    colors: "fill-violet-700 stroke-violet-300",
  },
  // 70–79: eight-point star
  {
    shape: svg`<polygon points=${starPoints(8, 15.5, 11)}></polygon>`,
    textY: 16.5,
    fontScale: 0.85,
    colors: "fill-fuchsia-700 stroke-fuchsia-300",
  },
  // 80–89: rosette (twelve shallow points)
  {
    shape: svg`<polygon points=${starPoints(12, 15.5, 12.5, -75)}></polygon>`,
    textY: 16.5,
    fontScale: 0.95,
    colors: "fill-rose-700 stroke-rose-300",
  },
  // 90–99: winged
  {
    shape: svg`<polygon
      points="16,3 23,8 31,5 28,16 31,27 23,24 16,29 9,24 1,27 4,16 1,5 9,8"
    ></polygon>`,
    textY: 16.5,
    fontScale: 0.9,
    colors: "fill-orange-700 stroke-orange-300",
  },
  // 100: crown
  {
    shape: svg`<path d=${CROWN}></path>`,
    textY: 21,
    fontScale: 0.95,
    colors: "fill-amber-600 stroke-yellow-200",
  },
];

function displayLevel(level: number): number {
  if (!Number.isFinite(level)) return 1;
  return Math.min(MAX_LEVEL, Math.max(1, Math.floor(level)));
}

/** "Level 42", "Level 42, Prestige 3" or "Legend". */
export function levelBadgeLabel(
  level: number,
  prestige: number,
  legend: boolean,
): string {
  if (legend) return translateText("progression.legend");
  const levelText = translateText("progression.level", {
    level: displayLevel(level),
  });
  const p = clampPrestige(prestige);
  if (p === 0) return levelText;
  return `${levelText}, ${translateText("progression.prestige", { prestige: p })}`;
}

@customElement("level-badge")
export class LevelBadge extends LitElement {
  @property({ type: Number }) level = 1;
  @property({ type: Number }) prestige = 0;
  @property({ type: Boolean }) legend = false;
  // Rendered size in CSS pixels (square). 16 is the smallest supported.
  @property({ type: Number }) size = 24;

  createRenderRoot() {
    return this;
  }

  /** Accessible name, e.g. "Level 42, Prestige 3". */
  label(): string {
    return levelBadgeLabel(this.level, this.prestige, this.legend);
  }

  private displayLevel(): number {
    return displayLevel(this.level);
  }

  private renderNumber(band: BandStyle): SVGTemplateResult {
    const text = String(this.displayLevel());
    // At nav size every pixel of glyph counts: let the number run a little
    // past the tighter frames, and thin the outline that keeps it readable
    // on light fills.
    const small = this.size < 24;
    const base =
      text.length === 1 ? 19 : text.length === 2 ? 16 : small ? 14 : 12;
    const fontSize =
      base * (small ? Math.max(band.fontScale, 0.95) : band.fontScale);
    return svg`<text
      x="16"
      y=${band.textY}
      text-anchor="middle"
      dominant-baseline="central"
      font-size=${fontSize}
      font-weight="800"
      font-family="Inter, Arial, sans-serif"
      class="fill-white"
      stroke="rgb(0 0 0 / 0.55)"
      stroke-width=${small ? 1.5 : 2.5}
      paint-order="stroke"
      textLength=${
        text.length === 3
          ? small
            ? 25
            : 21
          : text.length === 2 && band.twoDigitWidth !== undefined
            ? band.twoDigitWidth
            : nothing
      }
      lengthAdjust="spacingAndGlyphs"
    >${text}</text>`;
  }

  // The prestige emblem, drawn BEHIND the (shrunken) level frame so it reads
  // as a mark of rank around the whole badge rather than a sticker on it.
  // The tier's shape carries the rank group even at 16px; the numeral tab is
  // added where there is room for it.
  private renderPrestigeEmblem(tier: PrestigeTier): SVGTemplateResult {
    switch (tier) {
      case "ring":
        return svg`<circle
          cx="16" cy="16" r="14.6"
          class="fill-none stroke-amber-500"
          stroke-width="2.4"
        ></circle>`;
      case "double":
        return svg`
          <circle cx="16" cy="16" r="15" class="fill-none stroke-slate-200"
            stroke-width="1.6"></circle>
          <circle cx="16" cy="16" r="12.4" class="fill-none stroke-slate-300"
            stroke-width="1.2"></circle>`;
      case "sunburst":
        return svg`<polygon
          points=${starPoints(16, 16, 12.6)}
          class="fill-yellow-400 stroke-yellow-100"
          stroke-width="0.8"
          stroke-linejoin="round"
        ></polygon>`;
      case "radiant":
        // Eight long rays behind a gold burst: a silhouette no other tier
        // has, so the last rank stands apart even at 16px.
        return svg`
          <polygon points=${starPoints(8, 17.5, 8.5, -90)}
            class="fill-fuchsia-500 stroke-fuchsia-200" stroke-width="0.8"
            stroke-linejoin="round"></polygon>
          <polygon points=${starPoints(16, 14.8, 12.4, -78.75)}
            class="fill-yellow-300 stroke-yellow-100" stroke-width="0.5"
            stroke-linejoin="round"></polygon>`;
      case "none":
        return svg``;
    }
  }

  // One to three gems along the top of the emblem: the rank WITHIN its group
  // (P1/P2/P3 share a ring, P4/P5/P6 a double ring, …), so ranks read apart
  // at a glance and at sizes too small for the numeral tab. P10 is its own
  // group and needs none.
  private renderRankGems(
    prestige: number,
    tier: PrestigeTier,
  ): SVGTemplateResult | typeof nothing {
    if (tier === "none" || tier === "radiant") return nothing;
    const count = ((prestige - 1) % 3) + 1;
    const angles =
      count === 1 ? [-90] : count === 2 ? [-104, -76] : [-118, -90, -62];
    const r = tier === "sunburst" ? 15.2 : 14.6;
    return svg`${angles.map((deg) => {
      const a = (deg * Math.PI) / 180;
      const x = (16 + r * Math.cos(a)).toFixed(2);
      const y = 16 + r * Math.sin(a);
      const points = [
        `${x},${(y - 2.9).toFixed(2)}`,
        `${(Number(x) + 2.3).toFixed(2)},${y.toFixed(2)}`,
        `${x},${(y + 2.9).toFixed(2)}`,
        `${(Number(x) - 2.3).toFixed(2)},${y.toFixed(2)}`,
      ].join(" ");
      return svg`<polygon
        data-rank-gem
        points=${points}
        class="fill-sky-200 stroke-zinc-900"
        stroke-width="0.9"
        stroke-linejoin="round"
      ></polygon>`;
    })}`;
  }

  private renderPrestigeTab(
    prestige: number,
  ): SVGTemplateResult | typeof nothing {
    // Below 24px the numeral is unreadable; the emblem's shape still says
    // which group and the accessible name carries the exact rank.
    if (this.size < 24) return nothing;
    return svg`
      <rect x=${prestige >= 10 ? 8.5 : 10} y="25" width=${prestige >= 10 ? 15 : 12} height="7.5" rx="2"
        class="fill-zinc-900 stroke-yellow-300" stroke-width="1"></rect>
      <text
        x="16" y="29"
        text-anchor="middle"
        dominant-baseline="central"
        font-size="6.5"
        font-weight="800"
        font-family="Inter, Arial, sans-serif"
        class="fill-yellow-200"
        textLength=${prestige >= 10 ? 12 : nothing}
        lengthAdjust="spacingAndGlyphs"
      >P${prestige}</text>`;
  }

  // The level frame and number, shrunk inside the prestige emblem when there
  // is one.
  private renderFrame(band: BandStyle, prestiged: boolean): SVGTemplateResult {
    const inner = svg`
      <g class=${band.colors} stroke-width="2" stroke-linejoin="round">
        ${band.shape}
      </g>
      ${this.renderNumber(band)}`;
    if (!prestiged) return inner;
    // A little larger at nav size, where the number needs every pixel.
    const scale = this.size < 24 ? 0.78 : 0.72;
    return svg`<g transform="translate(16 ${this.size < 24 ? 16 : 15}) scale(${scale}) translate(-16 -16)">
      ${inner}
    </g>`;
  }

  private renderLegend(): SVGTemplateResult {
    return svg`
      <path
        d=${CROWN}
        class="fill-zinc-950 stroke-yellow-400"
        stroke-width="2.5"
        stroke-linejoin="round"
      ></path>
      <polygon
        points=${starPoints(5, 7, 3, -90, 20.5)}
        class="fill-yellow-300"
      ></polygon>
    `;
  }

  render() {
    const band = BANDS[levelBand(this.level)];
    const label = this.label();
    const px = Math.max(16, this.size);
    const prestige = clampPrestige(this.prestige);
    const tier = this.legend ? "none" : prestigeTier(prestige);
    const glow = this.legend
      ? "drop-shadow-[0_0_3px_rgba(250,204,21,0.6)]"
      : tier === "radiant"
        ? "drop-shadow-[0_0_3px_rgba(232,121,249,0.7)]"
        : "";
    return html`<svg
      viewBox="0 0 32 32"
      width=${px}
      height=${px}
      role="img"
      aria-label=${label}
      data-level-band=${this.legend ? "legend" : levelBand(this.level)}
      data-prestige-tier=${tier}
      class="block shrink-0 overflow-visible ${glow}"
    >
      <title>${label}</title>
      ${this.legend
        ? this.renderLegend()
        : svg`
          ${this.renderPrestigeEmblem(tier)}
          ${this.renderFrame(band, tier !== "none")}
          ${this.renderRankGems(prestige, tier)}
          ${tier !== "none" ? this.renderPrestigeTab(prestige) : nothing}
        `}
    </svg>`;
  }
}
