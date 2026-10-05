import { html, LitElement, nothing, svg, SVGTemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import {
  clampPrestige,
  levelBand,
  MAX_LEVEL,
  prestigeAccent,
  prestigeStyle,
  PrestigeStyle,
} from "../Progression";
import { translateText } from "../Utils";

// A player's level as a small emblem: the number inside a frame whose SHAPE
// (not just colour, for colour-blind players) changes every ten levels, a
// prestige emblem around it once they have prestiged (a different outline
// and colour for every rank, see prestigeStyle), and its own look for
// Legend.
//
// Drawn on a 32x32 grid so it scales from the 16px nav badge up to the profile
// header without separate art.
//
// Lists draw a badge on every row (150 in a full lobby), so the emblem's
// markup is built once per look — rank, band, size class and digit count —
// and each badge after that is a clone of it plus its number (see
// emblemTemplate). The prismatic gradient lives once per document (or shadow
// root), not once per badge (see ensureSharedDefs).

interface BandStyle {
  // Frame outline on the 32x32 grid, as markup.
  shape: string;
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

const pointList = (pts: readonly (readonly [number, number])[]): string =>
  pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");

// A point `r` from the centre at `deg` degrees (0 = right, -90 = up).
const polar = (deg: number, r: number): [number, number] => [
  16 + r * Math.cos((deg * Math.PI) / 180),
  16 + r * Math.sin((deg * Math.PI) / 180),
];

const CROWN = "M2 9 L9 15 L16 4 L23 15 L30 9 L27 29 H5 Z";

// Index = levelBand(level): 1–9, 10–19, … 90–99, then 100.
const BANDS: readonly BandStyle[] = [
  // 1–9: circle
  {
    shape: `<circle cx="16" cy="16" r="14.5"></circle>`,
    textY: 16.5,
    fontScale: 1,
    colors: "fill-slate-600 stroke-slate-300",
  },
  // 10–19: rounded square
  {
    shape: `<rect x="2.5" y="2.5" width="27" height="27" rx="6"></rect>`,
    textY: 16.5,
    fontScale: 1,
    colors: "fill-emerald-700 stroke-emerald-300",
  },
  // 20–29: diamond
  {
    shape: `<polygon points="16,0.5 31.5,16 16,31.5 0.5,16"></polygon>`,
    textY: 16.5,
    fontScale: 0.95,
    twoDigitWidth: 15,
    colors: "fill-teal-700 stroke-teal-300",
  },
  // 30–39: shield
  {
    shape: `<path d="M3.5 2.5 H28.5 V15 C28.5 23 22.5 28 16 31 C9.5 28 3.5 23 3.5 15 Z"></path>`,
    textY: 15,
    fontScale: 0.95,
    colors: "fill-sky-700 stroke-sky-300",
  },
  // 40–49: hexagon
  {
    shape: `<polygon points="16,1.5 29,9 29,23 16,30.5 3,23 3,9"></polygon>`,
    textY: 16.5,
    fontScale: 0.95,
    colors: "fill-blue-700 stroke-blue-300",
  },
  // 50–59: octagon
  {
    shape: `<polygon points="10.5,2 21.5,2 30,10.5 30,21.5 21.5,30 10.5,30 2,21.5 2,10.5"></polygon>`,
    textY: 16.5,
    fontScale: 1,
    colors: "fill-indigo-700 stroke-indigo-300",
  },
  // 60–69: banner with a notched tail
  {
    shape: `<path d="M3.5 2 H28.5 V30.5 L16 24 L3.5 30.5 Z"></path>`,
    textY: 13.5,
    fontScale: 0.95,
    colors: "fill-violet-700 stroke-violet-300",
  },
  // 70–79: eight-point star
  {
    shape: `<polygon points="${starPoints(8, 15.5, 11)}"></polygon>`,
    textY: 16.5,
    fontScale: 0.85,
    colors: "fill-fuchsia-700 stroke-fuchsia-300",
  },
  // 80–89: rosette (twelve shallow points)
  {
    shape: `<polygon points="${starPoints(12, 15.5, 12.5, -75)}"></polygon>`,
    textY: 16.5,
    fontScale: 0.95,
    colors: "fill-rose-700 stroke-rose-300",
  },
  // 90–99: winged
  {
    shape: `<polygon points="16,3 23,8 31,5 28,16 31,27 23,24 16,29 9,24 1,27 4,16 1,5 9,8"></polygon>`,
    textY: 16.5,
    fontScale: 0.9,
    colors: "fill-orange-700 stroke-orange-300",
  },
  // 100: crown
  {
    shape: `<path d="${CROWN}"></path>`,
    textY: 21,
    fontScale: 0.95,
    colors: "fill-amber-600 stroke-yellow-200",
  },
];

// The light colour of each band's frame (its Tailwind stroke, written out),
// by levelBand: the profile card's glow behind an unprestiged badge.
const BAND_ACCENTS = [
  "#cbd5e1",
  "#6ee7b7",
  "#5eead4",
  "#7dd3fc",
  "#93c5fd",
  "#a5b4fc",
  "#c4b5fd",
  "#f0abfc",
  "#fda4af",
  "#fdba74",
  "#fef08a",
] as const;

const LEGEND_ACCENT = "#facc15";
const LEGEND_GLOW = "rgba(250,204,21,0.85)";

// Side margin, as a share of the badge's size, for a winged emblem (P5,
// P10): the wings reach past the badge's box, and must never touch the name
// beside it.
export const WINGED_MARGIN = 0.12;

/**
 * The badge's accent colour, for a glow or a highlight around it: the
 * prestige rank's own colour once prestiged, the level band's before.
 */
export function levelBadgeAccent(
  level: number,
  legend: boolean,
  prestige = 0,
): string {
  if (legend) return LEGEND_ACCENT;
  if (clampPrestige(prestige) > 0) return prestigeAccent(prestige);
  return BAND_ACCENTS[levelBand(level)];
}

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

// ---------------------------------------------------------------------------
// Shared definitions: the prismatic medal's gradient, once per document or
// shadow root rather than once per badge.
// ---------------------------------------------------------------------------

const SVG_NS = "http://www.w3.org/2000/svg";

/** Id of the prismatic medal's gradient, shared by every badge in a root. */
export const PRISM_GRADIENT_ID = "level-badge-prism";

// The gradient sits in a zero-size, never-hidden <svg> at the end of the
// badge's root: a gradient inside a display:none subtree paints nothing in
// some browsers, so it must not live in any one badge (which may be hidden).
// url(#id) resolves within the badge's own tree, so a badge inside a shadow
// root gets its own copy there.
function ensureSharedDefs(host: Element): void {
  if (!host.isConnected) return;
  const root = host.getRootNode() as Document | ShadowRoot;
  if (root.getElementById(PRISM_GRADIENT_ID) !== null) return;
  const doc = host.ownerDocument;
  const el = (name: string, attrs: Record<string, string>): Element => {
    const node = doc.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };
  const sprite = el("svg", {
    "data-level-badge-defs": "",
    "aria-hidden": "true",
    focusable: "false",
    width: "0",
    height: "0",
    style:
      "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none",
  });
  const gradient = el("linearGradient", {
    id: PRISM_GRADIENT_ID,
    x1: "0",
    y1: "0",
    x2: "1",
    y2: "1",
  });
  for (const [offset, color] of [
    ["0", "#ff5fa8"],
    ["0.5", "#9d5cff"],
    ["1", "#38bdf8"],
  ]) {
    gradient.append(el("stop", { offset, "stop-color": color }));
  }
  const defs = el("defs", {});
  defs.append(gradient);
  sprite.append(defs);
  const parent: ParentNode =
    root instanceof ShadowRoot ? root : (doc.body ?? doc.documentElement);
  parent.append(sprite);
}

// ---------------------------------------------------------------------------
// Emblem primitives, on the 32x32 grid, as markup. Every value in them comes
// from this file's own constants and arithmetic, never from a caller.
// ---------------------------------------------------------------------------

function disc(r: number, fill: string, stroke: string, width: number): string {
  return `<circle cx="16" cy="16" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"></circle>`;
}

function poly(
  points: string,
  fill: string,
  stroke: string,
  width: number,
): string {
  return `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round"></polygon>`;
}

// One wing (the left), mirrored for the right. `k` scales it out from the
// badge's side.
const WING: readonly (readonly [number, number])[] = [
  [9, 5],
  [-4, 1],
  [0.5, 7],
  [-5, 8.5],
  [0, 12.5],
  [-4.5, 15.5],
  [0.5, 17.5],
  [-2, 22],
  [6, 21.5],
  [8, 16],
];

function wings(fill: string, stroke: string, width: number, k: number): string {
  const left = WING.map(
    ([x, y]) => [8 + (x - 8) * k, 13 + (y - 13) * k] as const,
  );
  const right = left.map(([x, y]) => [32 - x, y] as const);
  return (
    poly(pointList(left), fill, stroke, width) +
    poly(pointList(right), fill, stroke, width)
  );
}

// Seven leaves up each side, from the foot of the badge to its shoulders.
function laurel(fill: string, stroke: string): string {
  const r = 15.3;
  let leaves = "";
  for (let i = 0; i < 7; i++) {
    const deg = 128 + ((252 - 128) * i) / 6;
    const [cx, cy] = polar(deg, r);
    const rot = deg + 90 - 28;
    for (const [x, turn] of [
      [cx, rot],
      [32 - cx, -rot],
    ]) {
      const ex = x.toFixed(2);
      const ey = cy.toFixed(2);
      leaves += `<ellipse cx="${ex}" cy="${ey}" rx="3" ry="1.45" transform="rotate(${turn.toFixed(2)} ${ex} ${ey})" fill="${fill}" stroke="${stroke}" stroke-width="0.8"></ellipse>`;
    }
  }
  return leaves;
}

// Points rising from behind the badge's rim at the given angles.
function spikes(
  angles: readonly number[],
  lengths: readonly number[],
  fill: string,
  stroke: string,
): string {
  return angles
    .map((deg, i) =>
      poly(
        pointList([
          polar(deg - 9, 12.8),
          polar(deg, lengths[i]),
          polar(deg + 9, 12.8),
        ]),
        fill,
        stroke,
        1,
      ),
    )
    .join("");
}

const PRISM = [
  "#ff4f9a",
  "#ffa53b",
  "#ffe45c",
  "#47e0a0",
  "#46b4ff",
  "#a46bff",
];

// Rays in every colour, for the last rank.
function prismRays(n: number, outer: number, inner: number): string {
  const half = 180 / n;
  return Array.from({ length: n }, (_, i) => {
    const deg = -90 + (i * 360) / n;
    return poly(
      pointList([
        polar(deg - half, inner),
        polar(deg, outer),
        polar(deg + half, inner),
      ]),
      PRISM[i % PRISM.length],
      "#ffffff",
      0.6,
    );
  }).join("");
}

// A five-point star on top of the badge: a milestone rank.
function topStar(
  fill: string,
  stroke: string,
  cy: number,
  outer: number,
  inner: number,
): string {
  return poly(starPoints(5, outer, inner, -90, cy), fill, stroke, 0.9);
}

// The prestige emblem, drawn BEHIND the (shrunken) level frame so it reads
// as a mark of rank around the whole badge rather than a sticker on it.
// Every rank has its own outline in its own colour, so ranks read apart
// even at 16px; the numeral tab is added where there is room for it.
function prestigeEmblem(style: PrestigeStyle): string {
  const { base, light, dark } = style;
  switch (style.outline) {
    case "plain":
      return disc(15, base, light, 1.6);
    case "points":
      return (
        poly(starPoints(4, 19, 9.5, -45), base, light, 1.1) +
        disc(14, base, light, 1.4)
      );
    case "laurel":
      return laurel(base, light) + disc(13.6, base, light, 1.4);
    case "star":
      return (
        poly(starPoints(8, 18.2, 13.2), base, light, 1) +
        disc(13.4, base, light, 1.2)
      );
    case "wings":
      return (
        wings(base, light, 1.1, 0.9) +
        disc(14.4, base, light, 2.2) +
        disc(12.5, "none", light, 0.9) +
        topStar(light, dark, 2.6, 4.8, 2.1)
      );
    case "tiara":
      return (
        spikes(
          [-150, -120, -90, -60, -30],
          [16.8, 18.2, 19.8, 18.2, 16.8],
          base,
          light,
        ) + disc(14, base, light, 1.4)
      );
    case "compass":
      return (
        poly(starPoints(4, 16.8, 6, -45), base, light, 1) +
        poly(starPoints(4, 19.8, 6.5, -90), base, light, 1.1) +
        disc(13.4, base, light, 1.2)
      );
    case "sun":
      return (
        poly(starPoints(16, 18, 14.2), base, light, 0.8) +
        disc(13.8, base, light, 1.2)
      );
    case "crystal":
      return (
        poly(starPoints(6, 19.5, 10.5), base, light, 1.1) +
        disc(13.4, base, light, 1.2)
      );
    case "prismatic":
      // Rays in every colour behind big wings and a prismatic medal.
      return (
        prismRays(12, 19.8, 12.5) +
        wings(light, "#ffffff", 1, 1.1) +
        disc(14.6, `url(#${PRISM_GRADIENT_ID})`, "#ffffff", 2) +
        disc(12.4, "none", "#ffffff", 0.8) +
        topStar("#ffffff", dark, 2.2, 5.2, 2.3)
      );
  }
}

// The number's <text>, up to its content. At nav size every pixel of glyph
// counts: let the number run a little past the tighter frames, and thin the
// outline that keeps it readable on light fills.
function numberOpen(band: BandStyle, digits: number, small: boolean): string {
  const base = digits === 1 ? 19 : digits === 2 ? 16 : small ? 14 : 12;
  const fontSize =
    base * (small ? Math.max(band.fontScale, 0.95) : band.fontScale);
  const textLength =
    digits === 3
      ? small
        ? 25
        : 21
      : digits === 2 && band.twoDigitWidth !== undefined
        ? band.twoDigitWidth
        : null;
  return (
    `<text x="16" y="${band.textY}" text-anchor="middle" dominant-baseline="central" font-size="${fontSize}" font-weight="800" font-family="Inter, Arial, sans-serif" class="fill-white" stroke="rgb(0 0 0 / 0.55)" stroke-width="${small ? 1.5 : 2.5}" paint-order="stroke"` +
    (textLength === null ? "" : ` textLength="${textLength}"`) +
    ` lengthAdjust="spacingAndGlyphs">`
  );
}

// The level frame and number, shrunk inside the prestige emblem when there
// is one. The frame keeps its level band's SHAPE either way (levels still
// progress within a run), but once prestiged it takes the rank's colours.
// Returned in two halves, either side of the number.
function frame(
  band: BandStyle,
  style: PrestigeStyle | null,
  digits: number,
  small: boolean,
): [string, string] {
  const colours =
    style === null
      ? `class="${band.colors}"`
      : `fill="${style.frame}" stroke="${style.light}"`;
  const open =
    `<g data-level-frame ${colours} stroke-width="2" stroke-linejoin="round">${band.shape}</g>` +
    numberOpen(band, digits, small);
  if (style === null) return [open, "</text>"];
  // A little larger at nav size, where the number needs every pixel.
  const scale = small ? 0.78 : 0.72;
  return [
    `<g transform="translate(16 ${small ? 16 : 15}) scale(${scale}) translate(-16 -16)">${open}`,
    "</text></g>",
  ];
}

// The numeral tab's <text>, up to its content. Only where there is room:
// below 24px the numeral is unreadable, and the emblem's outline and the
// accessible name carry the rank instead.
function tabOpen(style: PrestigeStyle): string {
  const wide = style.rank >= 10;
  return (
    `<rect data-prestige-tab x="${wide ? 8.5 : 10}" y="25" width="${wide ? 15 : 12}" height="7.5" rx="2" class="fill-zinc-900" stroke="${style.light}" stroke-width="1"></rect>` +
    `<text x="16" y="29" text-anchor="middle" dominant-baseline="central" font-size="6.5" font-weight="800" font-family="Inter, Arial, sans-serif" fill="${style.light}"` +
    (wide ? ` textLength="12"` : "") +
    ` lengthAdjust="spacingAndGlyphs">`
  );
}

// Legend: a black crown with a gold star on a gold sunburst halo, gems on
// its points.
function legendMarkup(): string {
  const gems: [number, number, string][] = [
    [2, 9, "#38bdf8"],
    [16, 4, "#f43f5e"],
    [30, 9, "#38bdf8"],
  ];
  return (
    `<polygon data-legend-halo points="${starPoints(20, 18.5, 14.2, -90, 17)}" fill="#facc15" stroke="#fef9c3" stroke-width="0.7" stroke-linejoin="round"></polygon>` +
    `<path d="${CROWN}" class="fill-zinc-950 stroke-yellow-400" stroke-width="2.5" stroke-linejoin="round"></path>` +
    `<polygon points="${starPoints(5, 7, 3, -90, 20.5)}" class="fill-yellow-300"></polygon>` +
    gems
      .map(
        ([cx, cy, fill]) =>
          `<circle data-legend-gem cx="${cx}" cy="${cy}" r="2.1" fill="${fill}" stroke="#fef9c3" stroke-width="0.8"></circle>`,
      )
      .join("")
  );
}

// ---------------------------------------------------------------------------
// One Lit template per look. Lit caches a template by the identity of its
// strings array, so handing it the same array for every badge with the same
// look makes each badge after the first a clone of parsed markup, with only
// the number (and the rank's tab label) filled in. The markup is built only
// from the constants above; the two pieces of text go in as ordinary,
// escaped Lit values.
// ---------------------------------------------------------------------------

const templates = new Map<string, TemplateStringsArray>();

function stringsFor(key: string, build: () => string[]): TemplateStringsArray {
  let strings = templates.get(key);
  if (strings === undefined) {
    const parts = build();
    strings = Object.assign(parts, {
      raw: [...parts],
    }) as unknown as TemplateStringsArray;
    templates.set(key, strings);
  }
  return strings;
}

function legendTemplate(): SVGTemplateResult {
  return svg(stringsFor("legend", () => [legendMarkup()]));
}

function emblemTemplate(
  level: number,
  style: PrestigeStyle | null,
  small: boolean,
): SVGTemplateResult {
  const bandIndex = levelBand(level);
  const band = BANDS[bandIndex];
  const text = String(displayLevel(level));
  const digits = text.length;
  const tab = style !== null && !small;
  const key = `${style?.rank ?? 0}:${bandIndex}:${digits}:${small ? "s" : "m"}`;
  const strings = stringsFor(key, () => {
    const [frameOpen, frameClose] = frame(band, style, digits, small);
    const emblem = style === null ? "" : prestigeEmblem(style);
    if (!tab) return [emblem + frameOpen, frameClose];
    return [emblem + frameOpen, frameClose + tabOpen(style), "</text>"];
  });
  if (!tab) return svg(strings, text);
  return svg(
    strings,
    text,
    translateText("progression.prestige_short", { prestige: style.rank }),
  );
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

  connectedCallback(): void {
    super.connectedCallback();
    this.ensureDefs();
  }

  protected updated(): void {
    this.ensureDefs();
  }

  // Only the last rank's medal uses a gradient.
  private ensureDefs(): void {
    if (!this.legend && prestigeStyle(this.prestige)?.outline === "prismatic") {
      ensureSharedDefs(this);
    }
  }

  /** Accessible name, e.g. "Level 42, Prestige 3". */
  label(): string {
    return levelBadgeLabel(this.level, this.prestige, this.legend);
  }

  render() {
    const label = this.label();
    const px = Math.max(16, this.size);
    const style = this.legend ? null : prestigeStyle(this.prestige);
    const glow = this.legend ? LEGEND_GLOW : (style?.glow ?? null);
    const margin = style?.winged ? Math.round(px * WINGED_MARGIN) : 0;
    const inline = [
      glow !== null ? `filter: drop-shadow(0 0 3px ${glow})` : "",
      margin > 0 ? `margin-left: ${margin}px; margin-right: ${margin}px` : "",
    ]
      .filter((s) => s !== "")
      .join("; ");
    return html`<svg
      viewBox="0 0 32 32"
      width=${px}
      height=${px}
      role="img"
      aria-label=${label}
      data-level-band=${this.legend ? "legend" : levelBand(this.level)}
      data-prestige-tier=${style?.id ?? "none"}
      data-winged=${style?.winged ? "true" : nothing}
      class="block shrink-0 overflow-visible"
      style=${inline === "" ? nothing : inline}
    >
      <title>${label}</title>
      ${this.legend
        ? legendTemplate()
        : emblemTemplate(this.level, style, this.size < 24)}
    </svg>`;
  }
}
