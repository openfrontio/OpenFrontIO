import { colord } from "colord";
import {
  html,
  LitElement,
  nothing,
  svg,
  SVGTemplateResult,
  TemplateResult,
} from "lit";
import { customElement, property } from "lit/decorators.js";
import {
  Effect,
  NukeExplosionAttributes,
  StructuresEffectAttributes,
  TrailEffectAttributes,
} from "../../core/CosmeticSchemas";

// ---------------------------------------------------------------------------
// Scene previews — a tiny slice of the map, in tile units, drawn the way the
// GL passes draw it: pixel sprites recolored by band, trails stamped one tile
// wide, rails on the 3×3 sub-grid, the city as the structure pass's ringed
// circle with its glyph. The effect paints exactly what it paints in game
// (trail / structure fill / warship light band / both train bands / rails),
// with the same gradient geometry and timing as the shaders.
// ---------------------------------------------------------------------------

/** Any effect that previews as a scene (nuke explosions have their own swatches). */
export type SceneEffect = Exclude<Effect, { effectType: "nukeExplosion" }>;

// The preview's stand-in for "you": a default-theme human color
// (default-theme.json) with the theme's border rule (borderDarken 0.125).
const PLAYER = colord("#4ade80");
const PLAYER_COLOR = PLAYER.toHex();
const BORDER_COLOR = PLAYER.darken(0.125).toHex();
// Terrain (render-settings.json): deep water and plains.
const WATER = "#4785b5";
const PLAINS = "#bedc8a";
// Territory and trails paint over terrain at mapOverlay.territoryAlpha /
// trailAlpha.
const TERRITORY_ALPHA = 0.588;
const TRAIL_ALPHA = 0.588;
// The local player's rails take the theme's focused-border color (white).
const RAIL_COLOR = "#ffffff";
// The structure pass darkens the player color for the icon fill and border
// (HSV value × fillDarken / borderDarken); the local player's border starts
// from the territory color.
const STRUCTURE_FILL = scaleValue(PLAYER_COLOR, 0.65);
const STRUCTURE_BORDER = scaleValue(PLAYER_COLOR, 0.1);
// Nukes flicker through unit.frag.glsl's hot colors (light band) with the
// mid band halfway to the color two steps on. In game this cycles every few
// frames; the preview flickers at a pace that doesn't strobe a card grid.
const FLICKER = ["#ff0000", "#ff8000", "#ffff00", "#ffffff"];
const FLICKER_MID = FLICKER.map((c, i) => mixRgb(c, FLICKER[(i + 2) % 4]));
const FLICKER_DUR_S = 1.2;
// Gradient scroll periods are clamped so extreme catalog values still
// visibly move (and don't blur).
const MIN_PERIOD_S = 0.8;
const MAX_PERIOD_S = 6;

// City glyph from resources/images/CityIcon.svg (24×24 viewBox), as baked
// into the structure icon atlas.
const CITY_GLYPH =
  "M13 9a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v13h11zM6 20H4v-2h2zm0-4H4v-2h2zm0-4H4v-2h2zm5 8H8v-2h3zm0-4H8v-2h3zm0-4H8v-2h3zm3.5-6H6V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7h-3V6.5a.5.5 0 0 0-.5-.5zm7.5 7v9h-2.5v-4h-2v4H15v-9a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1z";

// Grayscale sprite templates from resources/sprites, by unit.frag.glsl band:
// L = 180 (light → territory color), M = 130 (mid → spawn color),
// D = 70 (dark → border color). One character per tile.
type Band = "L" | "M" | "D";
const TRANSPORT_SHIP = ["..D..", ".DLD.", "DLLLD", ".DLD.", "..D.."];
const WARSHIP = [
  ".....L.....",
  "..LLLDLLL..",
  ".LLLDDDLLL.",
  ".LLDDDDDLL.",
  ".LDDDLDDDL.",
  "LDDDLLLDDDL",
  ".LDDDLDDDL.",
  ".LLDDDDDLL.",
  ".LLLDDDLLL.",
  "..LLLDLLL..",
  ".....L.....",
];
const TRAIN_ENGINE = [".....", "..D..", ".DDD.", "..D..", "....."];
const TRAIN_CARRIAGE = [".....", ".LLL.", ".LDL.", ".LLL.", "....."];
const ATOM_BOMB = [
  "....M....",
  "..MMMMM..",
  ".MMMLMMM.",
  ".MMLLLMM.",
  "MMLLLLLMM",
  ".MMLLLMM.",
  ".MMMLMMM.",
  "..MMMMM..",
  "....M....",
];

// Rail types (RailroadPass texture values) drawn in the scenes.
const RAIL_VERTICAL = 1;
const RAIL_HORIZONTAL = 2;
const RAIL_TOP_RIGHT = 4;

function scaleValue(hex: string, k: number): string {
  const hsv = colord(hex).toHsv();
  return colord({ h: hsv.h, s: hsv.s, v: hsv.v * k }).toHex();
}

function mixRgb(a: string, b: string, t = 0.5): string {
  const ca = colord(a).toRgb();
  const cb = colord(b).toRgb();
  return colord({
    r: ca.r + (cb.r - ca.r) * t,
    g: ca.g + (cb.g - ca.g) * t,
    b: ca.b + (cb.b - ca.b) * t,
  }).toHex();
}

/** Catalog colors the renderer would keep (it drops any it can't parse). */
function validColors(colors: readonly string[]): string[] {
  return colors
    .filter((c) => colord(c).isValid())
    .map((c) => colord(c).toHex());
}

// ---------------------------------------------------------------------------
// Paints — a fill plus (optionally) the SMIL animation that drives it. The
// animation element goes inside the painted element; gradients go in <defs>.
// ---------------------------------------------------------------------------

interface Paint {
  fill: string;
  anim: SVGTemplateResult | typeof nothing;
}

const solid = (fill: string): Paint => ({ fill, anim: nothing });

/**
 * Where a gradient effect's palette cycle sits in the scene:
 * - world: trail semantics (trail/railroad/train shaders) — the palette
 *   repeats along the map diagonal x + y, colorSize tiles per color,
 *   scrolling movementSpeed tiles/s.
 * - icon: sprite semantics (structure/warship shaders) — the palette spans
 *   the sprite's diagonal once (the whole gradient is visible on the shape),
 *   sliding one cycle every colorSize · count / movementSpeed seconds.
 */
type GradientSpace =
  | { space: "world" }
  | { space: "icon"; x: number; y: number; size: number };

/**
 * The effect's paint for one recolored band, mirroring the shaders: a single
 * color is flat; spiral paints flat in its first color (the vortex is drawn
 * separately); transition cross-fades the whole band through the list, each
 * step lasting 1/frequency s; gradient is a repeating linear gradient in the
 * given space, scrolled by translating it one cycle per period (positive
 * movementSpeed toward +x+y, negative reversed; 0 static).
 */
function effectPaint(
  id: string,
  attrs: TrailEffectAttributes | StructuresEffectAttributes,
  colors: readonly string[],
  space: GradientSpace,
): { paint: Paint; defs: SVGTemplateResult | typeof nothing } {
  const n = colors.length;
  if (n === 1 || attrs.type === "spiral") {
    return { paint: solid(colors[0]), defs: nothing };
  }
  if (attrs.type === "transition") {
    const anim =
      attrs.frequency > 0
        ? svg`<animate
            attributeName="fill"
            values=${[...colors, colors[0]].join(";")}
            dur="${n / attrs.frequency}s"
            repeatCount="indefinite"
          ></animate>`
        : nothing;
    return { paint: { fill: colors[0], anim }, defs: nothing };
  }
  // gradient — one palette cycle is colorSize · count (tiles of x + y in
  // world space; the sprite diagonal in icon space). Both scroll one cycle
  // every cycle / |movementSpeed| seconds.
  const cycle = Math.max(attrs.colorSize, 0.001) * n;
  const [x1, y1, dx, dy] =
    space.space === "world"
      ? [0, 0, cycle / 2, cycle / 2]
      : [space.x, space.y, space.size, space.size];
  const speed = attrs.movementSpeed;
  const scroll =
    speed === 0
      ? nothing
      : svg`<animateTransform
          attributeName="gradientTransform"
          type="translate"
          from="0 0"
          to="${Math.sign(speed) * dx} ${Math.sign(speed) * dy}"
          dur="${Math.min(Math.max(cycle / Math.abs(speed), MIN_PERIOD_S), MAX_PERIOD_S)}s"
          repeatCount="indefinite"
        ></animateTransform>`;
  const defs = svg`<linearGradient
    id=${id}
    gradientUnits="userSpaceOnUse"
    spreadMethod="repeat"
    x1=${x1}
    y1=${y1}
    x2=${x1 + dx}
    y2=${y1 + dy}
  >
    ${colors.map((c, i) => svg`<stop offset=${i / n} stop-color=${c}></stop>`)}
    <stop offset="1" stop-color=${colors[0]}></stop>
    ${scroll}
  </linearGradient>`;
  return { paint: solid(`url(#${id})`), defs };
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Path of unit squares for every `band` pixel of a sprite placed at (ox, oy). */
function pixelPath(
  rows: readonly string[],
  band: Band,
  ox: number,
  oy: number,
): string {
  let d = "";
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === band) d += `M${ox + x} ${oy + y}h1v1h-1z`;
    }
  });
  return d;
}

/** A sprite centered on tile (cx, cy), one path per band. */
function sprite(
  rows: readonly string[],
  cx: number,
  cy: number,
  paints: Partial<Record<Band, Paint>>,
): SVGTemplateResult {
  const ox = cx - Math.floor(rows[0].length / 2);
  const oy = cy - Math.floor(rows.length / 2);
  return svg`<g shape-rendering="crispEdges">
    ${(Object.keys(paints) as Band[]).map((band) => {
      const paint = paints[band]!;
      return svg`<path d=${pixelPath(rows, band, ox, oy)} fill=${paint.fill}>
        ${paint.anim}
      </path>`;
    })}
  </g>`;
}

/** Path of unit squares along the bresenham line through the waypoints (the
 *  TrailManager stamp). */
function stampPath(points: readonly [number, number][]): string {
  let d = "";
  for (let p = 1; p < points.length; p++) {
    let [x0, y0] = points[p - 1];
    const [x1, y1] = points[p];
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      d += `M${x0} ${y0}h1v1h-1z`;
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }
  return d;
}

/** Detailed-zoom rail tile (railroad.frag.glsl railDetailCoverage): the two
 *  edge bands of the tile's 3×3 sub-grid the track runs along, plus the
 *  center tie. */
function railTilePath(rt: number, x: number, y: number): string {
  const T = 1 / 3;
  let d = "";
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      let hit = i === 1 && j === 1;
      if (rt === RAIL_VERTICAL) hit ||= i === 0 || i === 2;
      else if (rt === RAIL_HORIZONTAL) hit ||= j === 0 || j === 2;
      else if (rt === RAIL_TOP_RIGHT) hit ||= j === 0 || i === 2;
      if (hit) {
        d += `M${(x + i * T).toFixed(4)} ${(y + j * T).toFixed(4)}h${T.toFixed(4)}v${T.toFixed(4)}h-${T.toFixed(4)}z`;
      }
    }
  }
  return d;
}

/** Polyline of a spiral strand: a sine wave around the trail's centerline
 *  (the helix seen side-on) that flares from the nuke's side over `taperW`
 *  tiles to full amplitude, like the in-game vortex emerging from the unit. */
function strandPath(
  x0: number,
  x1: number,
  cy: number,
  amplitude: number,
  wavelength: number,
  taperW: number,
  phase: number,
): string {
  const pts: string[] = [];
  for (let x = x0; x <= x1; x += 0.5) {
    const taper = Math.min((x1 - x) / taperW, 1);
    const y =
      cy +
      amplitude *
        Math.sin((Math.PI / 2) * taper) *
        Math.sin((x / wavelength) * 2 * Math.PI + phase);
    pts.push(`${x} ${y.toFixed(2)}`);
  }
  return `M ${pts.join(" L ")}`;
}

function scene(
  size: number,
  defs: unknown,
  body: SVGTemplateResult,
): TemplateResult {
  return html`<svg
    class="block w-full h-full"
    viewBox="0 0 ${size} ${size}"
    preserveAspectRatio="xMidYMid slice"
  >
    <defs>${defs}</defs>
    ${body}
  </svg>`;
}

const water = (size: number) =>
  svg`<rect width=${size} height=${size} fill=${WATER}></rect>`;
const territory = (size: number) =>
  svg`<rect width=${size} height=${size} fill=${PLAINS}></rect>
    <rect width=${size} height=${size} fill=${PLAYER_COLOR} fill-opacity=${TERRITORY_ALPHA}></rect>`;

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

/** A transport ship in the player's colors with its trail stamped behind it
 *  across the water; the trail takes the effect (territory color without one). */
function transportShipTrailScene(
  id: string,
  attrs: TrailEffectAttributes,
  colors: string[],
): TemplateResult {
  const S = 24;
  const path: [number, number][] = [
    [1, 21],
    [7, 16],
    [12, 13],
    [18, 8],
  ];
  const { paint, defs } =
    colors.length > 0
      ? effectPaint(id, attrs, colors, { space: "world" })
      : { paint: solid(PLAYER_COLOR), defs: nothing };
  return scene(
    S,
    defs,
    svg`${water(S)}
      <path data-trail d=${stampPath(path)} fill=${paint.fill} opacity=${TRAIL_ALPHA} shape-rendering="crispEdges">
        ${paint.anim}
      </path>
      ${sprite(TRANSPORT_SHIP, 18, 8, { L: solid(PLAYER_COLOR), D: solid(BORDER_COLOR) })}`,
  );
}

/** A flickering atom bomb with its trail behind it. A spiral effect adds the
 *  vortex: neon strands (halo + core + white-hot center, like the in-game
 *  bloom split) tapering into the missile, dimming in phase order once per
 *  revolution (the depth-shaded spin), over the flat first-color spine. */
function nukeTrailScene(
  id: string,
  attrs: TrailEffectAttributes,
  colors: string[],
): TemplateResult {
  const S = 24;
  const cx = 17;
  const cy = 12;
  const { paint, defs } =
    colors.length > 0
      ? effectPaint(id, attrs, colors, { space: "world" })
      : { paint: solid(PLAYER_COLOR), defs: nothing };
  let strands: SVGTemplateResult | typeof nothing = nothing;
  if (attrs.type === "spiral" && colors.length > 0) {
    // Strand count mirrors the in-game clamp (max 8); the amplitude is the
    // helix radius in tiles, kept inside the scene.
    const count = Math.min(Math.max(Math.round(attrs.strands), 1), 8);
    const amplitude = Math.min(Math.max(attrs.radius, 1), 8);
    const periodS =
      attrs.rotationSpeed > 0 ? (2 * Math.PI) / attrs.rotationSpeed : 0;
    strands = svg`<g data-spiral fill="none" stroke-linecap="round">
      ${Array.from({ length: count }, (_, s) => {
        const d = strandPath(
          0,
          cx,
          cy + 0.5,
          amplitude,
          10,
          8,
          (s * 2 * Math.PI) / count,
        );
        const color = colors[s % colors.length];
        const delay = (-s * periodS) / count;
        const spin = (values: string) =>
          periodS > 0
            ? svg`<animate attributeName="opacity" values=${values} dur="${periodS}s" begin="${delay}s" repeatCount="indefinite"></animate>`
            : nothing;
        return svg`<g data-strand>
          ${spin("1;0.35;1")}
          <path d=${d} stroke=${color} stroke-width="2.4" opacity="0.55" style="filter:blur(0.6px);mix-blend-mode:screen"></path>
          <path d=${d} stroke=${color} stroke-width="0.9"></path>
          <path d=${d} stroke="#fff" stroke-width="0.35" opacity="0.9">
            ${spin("0.9;0;0.9")}
          </path>
        </g>`;
      })}
    </g>`;
  }
  const flicker = (values: readonly string[]): Paint => ({
    fill: values[0],
    anim: svg`<animate attributeName="fill" values=${values.join(";")} dur="${FLICKER_DUR_S}s" calcMode="discrete" repeatCount="indefinite"></animate>`,
  });
  return scene(
    S,
    defs,
    svg`${water(S)}
      <path data-trail d=${stampPath([
        [0, cy],
        [cx, cy],
      ])} fill=${paint.fill} opacity=${TRAIL_ALPHA} shape-rendering="crispEdges">
        ${paint.anim}
      </path>
      ${strands}
      ${sprite(ATOM_BOMB, cx, cy, { L: flicker(FLICKER), M: flicker(FLICKER_MID) })}`,
  );
}

/** A city on the player's territory, drawn like the structure pass: a ringed
 *  circle (border in the darkened player color) around the fill — the
 *  effect, or the darkened player color — with the white city glyph. */
function structuresScene(
  id: string,
  attrs: StructuresEffectAttributes,
  colors: string[],
): TemplateResult {
  // The gradient spans the icon's diagonal once; the shader anchors the
  // palette to the icon center (dn = 0 there), so the cycle starts half a
  // cell before the top-left corner.
  const { paint, defs } =
    colors.length > 0
      ? effectPaint(id, attrs, colors, {
          space: "icon",
          x: -0.5,
          y: -0.5,
          size: 1,
        })
      : { paint: solid(STRUCTURE_FILL), defs: nothing };
  const glyphSize = 0.59;
  return scene(
    1,
    svg`${defs}
      <clipPath id="${id}-fill"><circle cx="0.5" cy="0.5" r="0.39"></circle></clipPath>`,
    svg`${territory(1)}
      <circle cx="0.5" cy="0.5" r="0.45" fill=${STRUCTURE_BORDER}></circle>
      <circle data-fill cx="0.5" cy="0.5" r="0.39" fill=${paint.fill}>${paint.anim}</circle>
      <g clip-path="url(#${id}-fill)">
        <g
          transform="translate(${(1 - glyphSize) / 2} ${(1 - glyphSize) / 2}) scale(${glyphSize / 24})"
        >
          <path data-glyph d=${CITY_GLYPH} fill="#fff"></path>
        </g>
      </g>`,
  );
}

/** A warship on the water: the effect recolors its light band (the hull
 *  ring), the dark band keeps the player's border color. */
function warshipScene(
  id: string,
  attrs: StructuresEffectAttributes,
  colors: string[],
): TemplateResult {
  const S = 15;
  const { paint, defs } =
    colors.length > 0
      ? effectPaint(id, attrs, colors, { space: "icon", x: 2, y: 2, size: 11 })
      : { paint: solid(PLAYER_COLOR), defs: nothing };
  return scene(
    S,
    defs,
    svg`${water(S)}
      ${sprite(WARSHIP, 7, 7, { L: paint, D: solid(BORDER_COLOR) })}`,
  );
}

/** An engine and three carriages on a track across the player's territory.
 *  The effect recolors both sprite bands (the dark band at 60%) with
 *  world-space gradient bands running along the whole train. */
function trainScene(
  id: string,
  attrs: StructuresEffectAttributes,
  colors: string[],
): TemplateResult {
  const S = 24;
  const row = 11;
  const light =
    colors.length > 0
      ? effectPaint(id, attrs, colors, { space: "world" })
      : { paint: solid(PLAYER_COLOR), defs: nothing };
  const dark =
    colors.length > 0
      ? effectPaint(
          `${id}-dark`,
          attrs,
          colors.map((c) => scaleRgb(c, 0.6)),
          { space: "world" },
        )
      : { paint: solid(BORDER_COLOR), defs: nothing };
  let track = "";
  for (let x = 0; x < S; x++) track += railTilePath(RAIL_HORIZONTAL, x, row);
  return scene(
    S,
    svg`${light.defs}${dark.defs}`,
    svg`${territory(S)}
      <path data-rails d=${track} fill=${RAIL_COLOR}></path>
      ${[13, 15, 17].map((x) =>
        sprite(TRAIN_CARRIAGE, x, row, { L: light.paint, D: dark.paint }),
      )}
      ${sprite(TRAIN_ENGINE, 19, row, { D: dark.paint })}`,
  );
}

function scaleRgb(hex: string, k: number): string {
  const c = colord(hex).toRgb();
  return colord({ r: c.r * k, g: c.g * k, b: c.b * k }).toHex();
}

/** A track with a corner across the player's territory; the effect replaces
 *  the rail color with world-space bands traveling along the track. */
function railroadScene(
  id: string,
  attrs: StructuresEffectAttributes,
  colors: string[],
): TemplateResult {
  const S = 24;
  const row = 8;
  const col = 15;
  const { paint, defs } =
    colors.length > 0
      ? effectPaint(id, attrs, colors, { space: "world" })
      : { paint: solid(RAIL_COLOR), defs: nothing };
  let track = "";
  for (let x = 0; x < col; x++) track += railTilePath(RAIL_HORIZONTAL, x, row);
  track += railTilePath(RAIL_TOP_RIGHT, col, row);
  for (let y = row + 1; y < S; y++)
    track += railTilePath(RAIL_VERTICAL, col, y);
  return scene(
    S,
    defs,
    svg`${territory(S)}
      <path data-rails d=${track} fill=${paint.fill}>${paint.anim}</path>`,
  );
}

let sceneCount = 0;

/**
 * Scene preview of a trail-style effect (transport-ship trail, nuke trail,
 * structures, warship, train, railroad), filling its container. Each scene
 * shows the effect on the thing it recolors in game. Animation is SMIL inside
 * the SVG, so there is nothing to start or cancel.
 */
@customElement("effect-scene")
export class EffectScene extends LitElement {
  @property({ attribute: false })
  effect: SceneEffect | null = null;

  // Gradient/clip ids must be unique per instance — cards render many at once.
  private readonly uid = `effect-scene-${++sceneCount}`;

  // Light DOM so the shared Tailwind classes apply.
  createRenderRoot(): HTMLElement {
    return this;
  }

  render(): TemplateResult {
    const effect = this.effect;
    if (effect === null) return html``;
    const colors = validColors(effect.attributes.colors);
    let body: TemplateResult;
    switch (effect.effectType) {
      case "transportShipTrail":
        body = transportShipTrailScene(this.uid, effect.attributes, colors);
        break;
      case "nukeTrail":
        body = nukeTrailScene(this.uid, effect.attributes, colors);
        break;
      case "structures":
        body = structuresScene(this.uid, effect.attributes, colors);
        break;
      case "warship":
        body = warshipScene(this.uid, effect.attributes, colors);
        break;
      case "train":
        body = trainScene(this.uid, effect.attributes, colors);
        break;
      case "railroad":
        body = railroadScene(this.uid, effect.attributes, colors);
        break;
    }
    return html`<div
      data-effect-scene=${effect.effectType}
      class="w-full h-full rounded-md overflow-hidden"
    >
      ${body}
    </div>`;
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
