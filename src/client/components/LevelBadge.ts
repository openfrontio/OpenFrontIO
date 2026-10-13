import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { unsafeSVG } from "lit/directives/unsafe-svg.js";
import {
  clampPrestige,
  LEGEND_COLOR,
  MAX_LEVEL,
  MAX_PRESTIGE,
  prestigeAccent,
  type PrestigeTier,
  prestigeTier,
  TIER_COLORS,
} from "../Progression";
import { translateText } from "../Utils";
import {
  badgeArrived,
  dequeueBadge,
  queueBadge,
  shouldStagger,
  type StaggeredBadge,
} from "./LevelBadgeFill";
import {
  BADGE_ICON_ART,
  BADGE_ICON_SMALL,
  type BadgeIconArt,
} from "./LevelBadgeIcons";

// A player's level and prestige as a small emblem: the rank's OpenFront unit
// icon on a round plate, the level in a chip of pixel digits overlapping the
// plate's foot, and a 10-segment gauge on the rim with one segment lit per
// prestige rank. The rank's tier colours the gauge, icon and chip (Iron at P1
// up to a prismatic Champion at P10); the plate's finish rises with the tier
// and P5, P10 and Legend glow. Before the first prestige the plate is a
// neutral slate with a hexagon and an empty gauge; Legend is a black plate
// with a gold crown and a full gold gauge.
//
// Drawn 1:1 in CSS pixels (no viewBox scaling), so the chip and its digits
// snap to whole pixels at every size, from the 16px minimum to the 170px
// ceremony hero. Gradients and icons live once per page in a hidden <svg>
// (see badgeDefs) that every badge points into, so a lobby of 150 badges
// stays a handful of elements each.

type IconName =
  | "hex"
  | "city"
  | "factory"
  | "port"
  | "shield"
  | "sam"
  | "warship"
  | "silo"
  | "mushroom"
  | "mirv"
  | "crest"
  | "crown";

interface RankStyle {
  // Key into the per-page plate gradients.
  key: string;
  tier: PrestigeTier | "legend";
  icon: IconName;
  tint: string;
  // 0 flat … 4 gem sparkles on the rim and a brighter plate.
  finish: number;
  milestone?: boolean;
  prism?: boolean;
  legend?: boolean;
}

const RANK_ICONS: readonly IconName[] = [
  "hex",
  "city",
  "factory",
  "port",
  "shield",
  "sam",
  "warship",
  "silo",
  "mushroom",
  "mirv",
  "crest",
];
const FINISH = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4];

function rankStyle(prestige: number, legend: boolean): RankStyle {
  if (legend) {
    return {
      key: "legend",
      tier: "legend",
      icon: "crown",
      tint: LEGEND_COLOR,
      finish: 4,
      milestone: true,
      legend: true,
    };
  }
  const p = Math.min(MAX_PRESTIGE, prestige);
  const tier = prestigeTier(p);
  return {
    key: String(p),
    tier,
    icon: RANK_ICONS[p],
    tint: TIER_COLORS[tier],
    finish: FINISH[p],
    milestone: p === 5 || p === 10,
    prism: p === 10,
  };
}

const PRISM = [
  "#ff5fa8",
  "#ffa53b",
  "#ffe45c",
  "#47e0a0",
  "#46b4ff",
  "#a46bff",
];
const INK = "#0b1220";
const UNLIT = "#273244";

function glowOf(st: RankStyle): string | null {
  if (st.legend) return "rgba(250,204,21,0.95)";
  if (st.prism) return "rgba(244,114,182,0.95)";
  if (st.milestone) {
    const [r, g, b] = rgb(st.tint);
    return `rgba(${r},${g},${b},0.9)`;
  }
  return null;
}

function rgb(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

function mix(a: string, b: string, t: number): string {
  const p = rgb(a);
  const q = rgb(b);
  return (
    "#" +
    p
      .map((v, i) =>
        Math.round(v + (q[i] - v) * t)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

const f3 = (n: number): number => Math.round(n * 1000) / 1000;

// 5x7 digits drawn from the OpenFront wordmark font.
const DIGITS: Record<string, readonly string[]> = {
  0: [".###.", "##.##", "##.##", "##.##", "##.##", "##.##", ".###."],
  1: ["###", ".##", ".##", ".##", ".##", ".##", ".##"],
  2: ["####.", "...##", "...##", ".###.", "##...", "##...", "#####"],
  3: ["####.", "...##", "...##", ".###.", "...##", "...##", "####."],
  4: ["##.##", "##.##", "##.##", "#####", "...##", "...##", "...##"],
  5: ["#####", "##...", "##...", "####.", "...##", "...##", "####."],
  6: [".###.", "##...", "##...", "####.", "##.##", "##.##", ".###."],
  7: ["#####", "...##", "...##", "..##.", ".##..", ".##..", ".##.."],
  8: [".###.", "##.##", "##.##", ".###.", "##.##", "##.##", ".###."],
  9: [".###.", "##.##", "##.##", ".####", "...##", "...##", ".###."],
};

// Width of the digit block in digit pixels: glyphs plus the gaps between
// them (no trailing gap, so the block centres exactly).
const textWidth = (text: string): number =>
  [...text].reduce((a, c) => a + DIGITS[c][0].length, 0) + text.length - 1;

// The digits as one path of pixel runs.
function digitsPath(text: string, x0: number, y0: number, s: number): string {
  let d = "";
  let x = x0;
  for (const ch of text) {
    DIGITS[ch].forEach((row, j) => {
      let i = 0;
      while (i < row.length) {
        if (row[i] !== "#") {
          i++;
          continue;
        }
        let e = i;
        while (e < row.length && row[e] === "#") e++;
        d += `M${x + i * s} ${y0 + j * s}h${(e - i) * s}v${s}h${-(e - i) * s}z`;
        i = e;
      }
    });
    x += (DIGITS[ch][0].length + 1) * s;
  }
  return d;
}

interface Chip {
  s: number; // digit pixel size
  bw: number; // border width
  padX: number;
  padY: number;
  w: number;
  h: number;
  x: number;
}

// The chip in whole pixels, its digit block centred with equal padding.
// Horizontally centred in the badge by floor, so when the chip's width and
// the badge's differ in parity it sits half a pixel left, never alternating.
function chipGeometry(size: number, text: string): Chip {
  const k = size <= 28 ? 0.33 : size <= 64 ? 0.28 : 0.22;
  const s = Math.max(1, Math.floor((size * k) / 7));
  const bw = Math.max(1, Math.round(size / 32));
  const padY = Math.max(1, s);
  // "100" at 24/28px: a pixel less side padding keeps the chip near the
  // plate's width, so the gauge still shows either side of it.
  const padX = s + (text.length >= 3 && size <= 28 ? 0 : 1);
  const h = 7 * s + 2 * padY + 2 * bw;
  const w = textWidth(text) * s + 2 * padX + 2 * bw;
  return { s, bw, padX, padY, w, h, x: Math.floor((size - w) / 2) };
}

// Largest box of aspect a (w/h) centred at (cx, yc) within the band
// [yTop, yBot] and inside the circle (cx, cy, ri); its corners may poke a
// little past the circle (icon corners are mostly empty): slack.
function fitBox(
  a: number,
  yc: number,
  yTop: number,
  yBot: number,
  cy: number,
  ri: number,
  slack: number,
): { w: number; h: number } {
  const d = Math.abs(yc - cy);
  const rr = ri * slack;
  const A = a * a + 1;
  const hhCircle =
    (-d + Math.sqrt(Math.max(0, d * d - A * (d * d - rr * rr)))) / A;
  const hh = Math.min(hhCircle, (yBot - yTop) / 2, ri / a);
  return { w: 2 * hh * a, h: 2 * hh };
}

const arcPath = (
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number,
): string => {
  const p = (a: number) => [
    cx + r * Math.cos((a * Math.PI) / 180),
    cy + r * Math.sin((a * Math.PI) / 180),
  ];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  return `M${f3(x0)} ${f3(y0)}A${f3(r)} ${f3(r)} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${f3(x1)} ${f3(y1)}`;
};

// ---------------------------------------------------------------------------
// Shared definitions: one hidden <svg> per document (or shadow root) holding
// the plate gradients, the icons as <symbol>s and the prismatic gradients.
// Each is added the first time a badge needs it.

const DEFS_ID = "level-badge";

interface DefsHost {
  svg: SVGSVGElement;
  defs: SVGDefsElement;
  added: Set<string>;
}
const defsHosts = new WeakMap<Node, DefsHost>();

function badgeDefs(badge: Element): DefsHost {
  const root = badge.getRootNode();
  const existing = defsHosts.get(root);
  if (existing?.svg.isConnected) return existing;
  const parent = root instanceof ShadowRoot ? root : document.body;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  // Not display:none, which would switch the gradients off.
  svg.setAttribute(
    "style",
    "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none",
  );
  svg.setAttribute("data-level-badge-defs", "");
  const defs = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "defs",
  ) as SVGDefsElement;
  svg.appendChild(defs);
  parent.appendChild(svg);
  const host = { svg, defs, added: new Set<string>() };
  defsHosts.set(root, host);
  return host;
}

function plateGradient(key: string): string {
  const st = key === "legend" ? rankStyle(0, true) : rankStyle(+key, false);
  const isP0 = key === "0";
  const inner = st.legend
    ? "#0b0b0f"
    : isP0
      ? "#1e293b"
      : mix(st.tint, INK, 0.8);
  const innerHi = st.legend
    ? "#1c1917"
    : isP0
      ? "#334155"
      : mix(st.tint, INK, st.finish >= 4 ? 0.5 : 0.62);
  return `<radialGradient id="${DEFS_ID}-plate-${key}" cx="0.5" cy="0.35" r="0.65"><stop offset="0" stop-color="${innerHi}"/><stop offset="1" stop-color="${inner}"/></radialGradient>`;
}

function prismGradient(id: string, x1: number, x2: number, y2: number): string {
  const stops = PRISM.map(
    (c, i) =>
      `<stop offset="${f3(i / (PRISM.length - 1))}" stop-color="${c}"/>`,
  ).join("");
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f3(x1)}" y1="0" x2="${f3(x2)}" y2="${f3(y2)}">${stops}</linearGradient>`;
}

function iconSymbol(id: string, art: BadgeIconArt): string {
  const [x, y, w, h] = art.box;
  const vb = `${x} ${y} ${w} ${h}`;
  if (!art.mask)
    return `<symbol id="${id}" viewBox="${vb}">${art.body}</symbol>`;
  // The icon's own black parts cut into its white ones, as in the file.
  const box = `x="${x}" y="${y}" width="${w}" height="${h}"`;
  return `<symbol id="${id}" viewBox="${vb}"><mask id="${id}-m" maskUnits="userSpaceOnUse" ${box}>${art.body}</mask><rect ${box} mask="url(#${id}-m)"/></symbol>`;
}

// ---------------------------------------------------------------------------
// The full art of the icons that have a bold small silhouette is only drawn
// over 28px, so it is its own chunk, prefetched when the page is idle. A
// badge that needs it first draws the silhouette.

type LargeIcons = typeof import("./LevelBadgeLargeIcons").BADGE_ICON_LARGE;
let largeIcons: LargeIcons | null = null;
let largeLoad: Promise<void> | null = null;
const awaitingLarge = new Set<LevelBadge>();

/** Loads the full art of the badges' small-silhouette icons. */
export function loadLargeBadgeIcons(): Promise<void> {
  largeLoad ??= import("./LevelBadgeLargeIcons").then(
    (m) => {
      largeIcons = m.BADGE_ICON_LARGE;
      for (const badge of awaitingLarge) badge.requestUpdate();
      awaitingLarge.clear();
    },
    (e: unknown) => {
      // Keep the silhouettes; try again the next time one is needed.
      largeLoad = null;
      console.warn("level badge icons failed to load", e);
    },
  );
  return largeLoad;
}

let prefetchScheduled = false;
function prefetchLargeIcons(): void {
  if (prefetchScheduled) return;
  prefetchScheduled = true;
  const run = () => void loadLargeBadgeIcons();
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(run, { timeout: 5000 });
  } else {
    setTimeout(run, 2000);
  }
}

// ---------------------------------------------------------------------------

interface Drawing {
  markup: string;
  // Shared definitions it points at: [id, markup].
  defs: [string, () => string][];
  glow: string | null;
  // Drawn with an icon's silhouette while its full art loads.
  wantsLarge: boolean;
}

// Drawings by size, level, rank and art: a lobby repeats them a lot.
const drawings = new Map<string, Drawing>();
const MAX_DRAWINGS = 400;

function iconFor(
  name: IconName,
  size: number,
): { id: string; art: BadgeIconArt; wantsLarge: boolean } {
  const small = (BADGE_ICON_SMALL as Record<string, BadgeIconArt>)[name];
  // The shield and hexagon are always drawn from their filled outlines.
  if (name === "shield" || name === "hex") {
    return { id: `${DEFS_ID}-s-${name}`, art: small, wantsLarge: false };
  }
  const full = (BADGE_ICON_ART as Record<string, BadgeIconArt>)[name];
  if (full !== undefined) {
    return { id: `${DEFS_ID}-i-${name}`, art: full, wantsLarge: false };
  }
  if (size > 28) {
    const large = (largeIcons as Record<string, BadgeIconArt> | null)?.[name];
    if (large !== undefined) {
      return { id: `${DEFS_ID}-l-${name}`, art: large, wantsLarge: false };
    }
    return { id: `${DEFS_ID}-s-${name}`, art: small, wantsLarge: true };
  }
  return { id: `${DEFS_ID}-s-${name}`, art: small, wantsLarge: false };
}

function draw(
  size: number,
  text: string,
  prestige: number,
  legend: boolean,
): Drawing {
  const key = `${size}|${text}|${legend ? "L" : Math.min(MAX_PRESTIGE, prestige)}|${largeIcons ? 1 : 0}`;
  const cached = drawings.get(key);
  if (cached) return cached;

  const st = rankStyle(prestige, legend);
  const isP0 = st.key === "0";
  const c = chipGeometry(size, text);
  const cx = c.x + c.w / 2;
  const rw = Math.max(1, size / 20);
  const rimW = Math.max(1.6, rw * 1.7);
  const D = size - c.h / 2; // the plate's foot is the chip's mid-line
  const R = D / 2 - rimW / 2; // the rim's centre line
  const chipY = size - c.h;
  const cy = D / 2;
  const defs: [string, () => string][] = [];

  const plateId = `${DEFS_ID}-plate-${st.key}`;
  defs.push([plateId, () => plateGradient(st.key)]);
  let prismPaint: string | null = null;
  if (st.prism) {
    const id = `${DEFS_ID}-prism-${size}-${cx * 2}`;
    defs.push([id, () => prismGradient(id, cx - D / 2, cx + D / 2, D)]);
    prismPaint = `url(#${id})`;
  }

  // The plate, with a dark track under the gauge.
  let out = `<circle data-plate cx="${f3(cx)}" cy="${f3(cy)}" r="${f3(R)}" fill="url(#${plateId})" stroke="${INK}" stroke-width="${f3(rimW + Math.max(0.6, rw * 0.5))}"/>`;

  // The gauge: ten segments over the arc the chip leaves visible, filling
  // clockwise from the lower left; one lit per rank.
  const dy = chipY - cy;
  const tb =
    dy < R
      ? (Math.asin(Math.max(-1, Math.min(1, dy / R))) * 180) / Math.PI
      : 90;
  const a0 = 180 - tb;
  const seg = (180 + 2 * tb) / 10;
  const gap = Math.max((360 * 1.1) / (2 * Math.PI * R), 2.5);
  const lit = legend ? 10 : Math.min(MAX_PRESTIGE, prestige);
  let litD = "";
  let unlitD = "";
  for (let i = 0; i < 10; i++) {
    const d = arcPath(
      cx,
      cy,
      R,
      a0 + i * seg + gap / 2,
      a0 + (i + 1) * seg - gap / 2,
    );
    if (i < lit) litD += d;
    else unlitD += d;
  }
  const litPaint =
    prismPaint ?? (legend ? st.tint : mix(st.tint, "#ffffff", 0.22));
  if (unlitD) {
    out += `<path data-gauge="unlit" d="${unlitD}" fill="none" stroke="${UNLIT}" stroke-width="${f3(rimW)}"/>`;
  }
  if (litD) {
    out += `<path data-gauge="lit" d="${litD}" fill="none" stroke="${litPaint}" stroke-width="${f3(rimW)}"/>`;
  }

  // Gem sparkles on the rim, upper right, for the top tiers.
  if (st.finish >= 4) {
    const sparkle = (a: number, k: number) => {
      const px = cx + R * Math.cos((a * Math.PI) / 180);
      const py = cy + R * Math.sin((a * Math.PI) / 180);
      const s = Math.max(1.6, rw * 1.9) * k;
      const w = s * 0.28;
      return `M${f3(px)} ${f3(py - s)}L${f3(px + w)} ${f3(py - w)}L${f3(px + s)} ${f3(py)}L${f3(px + w)} ${f3(py + w)}L${f3(px)} ${f3(py + s)}L${f3(px - w)} ${f3(py + w)}L${f3(px - s)} ${f3(py)}L${f3(px - w)} ${f3(py - w)}Z`;
    };
    out += `<path data-sparkles d="${sparkle(-58, 1)}${sparkle(-28, 0.6)}" fill="#ffffff"/>`;
  }

  // The icon, centred on the plate's visible area (rim's inner edge to the
  // chip's top) by its artwork's measured box.
  const icon = iconFor(st.icon, size);
  defs.push([icon.id, () => iconSymbol(icon.id, icon.art)]);
  const innerR = R - rimW / 2;
  const margin = Math.max(1, size * 0.05);
  const yc = (cy - innerR + chipY) / 2;
  const yTop = 2 * yc - (chipY - margin);
  const yBot = chipY - margin;
  const [, , bw, bh] = icon.art.box;
  const box = fitBox(bw / bh, yc, yTop, yBot, cy, innerR - margin, 1.12);
  const iconFill = st.prism ? "#fff1f8" : isP0 ? "#64748b" : st.tint;
  out += `<use data-icon="${st.icon}" href="#${icon.id}" x="${f3(cx - box.w / 2)}" y="${f3(yc - box.h / 2)}" width="${f3(box.w)}" height="${f3(box.h)}" fill="${iconFill}"/>`;

  // The level chip.
  const chipFill = prismPaint ?? (isP0 ? "#94a3b8" : st.tint);
  const ink = legend ? "#1a1200" : INK;
  const r = Math.max(1, Math.round(c.h * 0.2));
  out +=
    `<g data-chip="${text}">` +
    `<rect x="${c.x + c.bw / 2}" y="${chipY + c.bw / 2}" width="${c.w - c.bw}" height="${c.h - c.bw}" rx="${r}" fill="${chipFill}" stroke="${INK}" stroke-width="${c.bw}"/>` +
    `<path d="${digitsPath(text, c.x + c.bw + c.padX, chipY + c.bw + c.padY, c.s)}" fill="${ink}" shape-rendering="crispEdges"/>` +
    `</g>`;

  const drawing = {
    markup: out,
    defs,
    glow: glowOf(st),
    wantsLarge: icon.wantsLarge,
  };
  if (drawings.size >= MAX_DRAWINGS) drawings.clear();
  drawings.set(key, drawing);
  return drawing;
}

/** The badge's accent colour, for a glow or a highlight around it. */
export function levelBadgeAccent(prestige: number, legend: boolean): string {
  return prestigeAccent(prestige, legend);
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

@customElement("level-badge")
export class LevelBadge extends LitElement implements StaggeredBadge {
  @property({ type: Number }) level = 1;
  @property({ type: Number }) prestige = 0;
  @property({ type: Boolean }) legend = false;
  // Rendered size in CSS pixels (square). 16 is the smallest supported.
  @property({ type: Number }) size = 24;

  // With the `stagger` attribute (long lists): when many badges appear at
  // once, this one first holds its square empty and is drawn on a later
  // frame (see LevelBadgeFill). Decided once, at its first render. The host
  // is aria-hidden meanwhile, so a screen reader meets no run of unnamed
  // elements.
  private waiting = false;

  createRenderRoot() {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    if (!this.hasUpdated && this.hasAttribute("stagger")) badgeArrived();
    else if (this.waiting) queueBadge(this);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.waiting) dequeueBadge(this);
    awaitingLarge.delete(this);
  }

  protected willUpdate(): void {
    if (!this.hasUpdated && this.hasAttribute("stagger") && shouldStagger()) {
      this.waiting = true;
      this.setAttribute("aria-hidden", "true");
      queueBadge(this);
    }
  }

  draw(): void {
    if (!this.waiting) return;
    this.waiting = false;
    this.removeAttribute("aria-hidden");
    this.requestUpdate();
  }

  /** Accessible name, e.g. "Level 42, Prestige 3". */
  label(): string {
    return levelBadgeLabel(this.level, this.prestige, this.legend);
  }

  render() {
    const px = Math.max(16, Math.round(this.size));
    if (this.waiting) {
      // The drawn badge's exact box, so nothing moves when it is drawn.
      return html`<span
        class="block shrink-0"
        style="width:${px}px;height:${px}px"
        aria-hidden="true"
        data-badge-waiting
      ></span>`;
    }
    const prestige = clampPrestige(this.prestige);
    const text = String(displayLevel(this.legend ? MAX_LEVEL : this.level));
    const drawing = draw(px, text, prestige, this.legend);
    const host = badgeDefs(this);
    for (const [id, make] of drawing.defs) {
      if (host.added.has(id)) continue;
      host.added.add(id);
      host.defs.insertAdjacentHTML("beforeend", make());
    }
    if (drawing.wantsLarge) {
      awaitingLarge.add(this);
      void loadLargeBadgeIcons();
    } else {
      prefetchLargeIcons();
    }
    const label = this.label();
    const glow = drawing.glow
      ? `filter:drop-shadow(0 0 ${f3(Math.max(2, px / 12))}px ${drawing.glow})`
      : nothing;
    return html`<svg
      width=${px}
      height=${px}
      role="img"
      aria-label=${label}
      data-prestige-tier=${this.legend ? "legend" : prestigeTier(prestige)}
      data-prestige=${this.legend ? "legend" : prestige}
      class="block shrink-0 overflow-visible"
      style=${glow}
    >
      <title>${label}</title>
      ${unsafeSVG(drawing.markup)}
    </svg>`;
  }
}
