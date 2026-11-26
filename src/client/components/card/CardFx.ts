import { assetUrl } from "@openfront/shared/AssetUrls";
import {
  type FlickerRate,
  type FxLayer,
  FX_DEFAULTS,
  type LayerAnimation,
  LayerAnimationSchema,
} from "@openfront/shared/CardBackgroundAnimation";

// Effect layers for animated card backgrounds: the effect maths (pure, so
// every client draws the same thing) and the controller that mounts and
// moves the layers inside a <card-background>. Only transform and opacity
// ever change.

// ---- Effect maths. `t` is seconds since the animation started. ----

const TAU = 2 * Math.PI;

function fract(x: number): number {
  return x - Math.floor(x);
}

// Pulse: opacity eases min → max → min once per period, times strength.
export function pulseOpacity(t: number, layer: FxLayer): number {
  const p = layer.period ?? FX_DEFAULTS.period;
  const min = layer.min ?? FX_DEFAULTS.min;
  const max = layer.max ?? FX_DEFAULTS.max;
  const strength = layer.strength ?? FX_DEFAULTS.strength;
  return (min + (max - min) * (0.5 - 0.5 * Math.cos((TAU * t) / p))) * strength;
}

// Shimmer: the band is this fraction of the card wide.
export const SHIMMER_BAND_WIDTH = 0.18;

// Shimmer: the band's left edge as a fraction of the card's width, from 30%
// off the left edge (-0.3) to 30% off the right (1.3), once per period.
export function shimmerBandX(t: number, layer: FxLayer): number {
  const p = layer.period ?? FX_DEFAULTS.period;
  return -0.3 + 1.6 * fract(t / p);
}

// Steeper than this the band would lie almost flat and its sideways reach
// grows without bound; the renderer draws it at this angle at most.
export const SHIMMER_MAX_ANGLE = 80;

// Shimmer, rotated: where the band's centre is and how long the band is,
// each as (a x card width + b x card height), so CSS container units can
// place it without measuring the card. Upright, the left edge runs from 30%
// off the left to 30% off the right as shimmerBandX says; tilted, the travel
// widens by the band's extra sideways reach inside the card's height, so it
// starts and ends wholly off the card.
//
// Its length keeps both ends off the card for the whole sweep: the band is
// centred on the card's middle row, so an end's nearest corner sits
// (L/2)·cos a − (b/2)·sin a from it, which must reach H/2. That needs
// L ≥ H/cos a + b·tan a (b = 18% of W); the length used is that plus W,
// which also keeps it at least the card's diagonal.
export function shimmerBand(
  t: number,
  layer: FxLayer,
): {
  // The centre's distance from the card's left edge, sideways only:
  // centreW × width + centreH × height. The height term is the tilted band's
  // extra reach (H/2 · tan a), not a vertical move: the centre always stays
  // on the card's middle row.
  centreW: number;
  centreH: number;
  lengthW: number;
  lengthH: number;
  angle: number;
} {
  const angle = Math.max(
    -SHIMMER_MAX_ANGLE,
    Math.min(SHIMMER_MAX_ANGLE, layer.angle ?? FX_DEFAULTS.angle),
  );
  const a = (Math.abs(angle) * Math.PI) / 180;
  const half = SHIMMER_BAND_WIDTH / 2;
  // Extra reach beyond the upright band, in card widths and card heights.
  const extraW = half * (1 / Math.cos(a) - 1);
  const extraH = 0.5 * Math.tan(a);
  const f = fract(t / (layer.period ?? FX_DEFAULTS.period));
  const startW = -0.3 + half - extraW;
  const endW = 1.3 + half + extraW;
  return {
    centreW: startW + f * (endW - startW),
    centreH: -extraH + f * 2 * extraH,
    lengthW: 1 + SHIMMER_BAND_WIDTH * Math.tan(a),
    lengthH: 1 / Math.cos(a),
    angle,
  };
}

// Drift: how far the doubled layer has moved left, in widths of the art as
// drawn (one card width when the card shows the whole art), [0, 1).
export function driftOffset(t: number, layer: FxLayer): number {
  const p = layer.period ?? FX_DEFAULTS.driftPeriod;
  return fract(t / p);
}

// Flicker: seconds between bursts, per rate.
export const FLICKER_GAPS: Record<FlickerRate, readonly [number, number]> = {
  low: [4, 8],
  medium: [2, 4],
  high: [1, 2],
};
const FLASH_MIN = 0.06;
const FLASH_MAX = 0.12;
// Seconds between flashes inside one burst.
const IN_BURST_GAP_MIN = 0.08;
const IN_BURST_GAP_MAX = 0.2;
// Never more than this many flashes in any one-second window.
const MAX_FLASHES_PER_SECOND = 3;

export interface Flash {
  // Seconds.
  start: number;
  duration: number;
}

// A small seeded PRNG (FNV-1a hash of the seed into mulberry32), so a
// background flickers the same way on every client.
function seededRandom(seed: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// Flicker: bursts of 1–3 flashes, each on for 60–120 ms, with the rate's gap
// before each burst, over `seconds`. Seeded with the background's id. A
// flash that would make a fourth in any one-second window is dropped.
export function flickerSchedule(
  seed: string,
  rate: FlickerRate,
  seconds: number,
): Flash[] {
  const random = seededRandom(seed);
  const between = (lo: number, hi: number) => lo + (hi - lo) * random();
  const [gapLo, gapHi] = FLICKER_GAPS[rate];
  const flashes: Flash[] = [];
  let t = 0;
  for (;;) {
    t += between(gapLo, gapHi);
    const count = 1 + Math.floor(random() * 3);
    let end = t;
    for (let i = 0; i < count; i++) {
      if (i > 0) t += between(IN_BURST_GAP_MIN, IN_BURST_GAP_MAX);
      const duration = between(FLASH_MIN, FLASH_MAX);
      if (t + duration > seconds) return flashes;
      const third = flashes[flashes.length - MAX_FLASHES_PER_SECOND];
      const crowded =
        third !== undefined && t - (third.start + third.duration) < 1;
      if (!crowded) flashes.push({ start: t, duration });
      t += duration;
      end = t;
    }
    t = end;
  }
}

// Whether a flash is on at `t` (the schedule loops over `length` seconds).
export function flickerOn(
  t: number,
  flashes: Flash[],
  length: number,
): boolean {
  const local = t - Math.floor(t / length) * length;
  for (const f of flashes) {
    if (local < f.start) return false;
    if (local < f.start + f.duration) return true;
  }
  return false;
}

// ---- The controller. ----

// Slow frames, judged per SLOW_WINDOW_MS window. A steady display at any
// rate from 20 fps up animates, whenever that rate starts: a 30 fps cap
// (Low Power Mode, battery saver, a 30 Hz panel, a throttled iframe) is a
// steady display, not a slow one.
//  - The cadence is the median of CADENCE_FRAMES intervals, measured when
//    the card starts, again after every pause, and again when a game starts
//    or ends under it.
//  - Outside a game, a card stops when a window averages under 20 fps
//    (MIN_FPS_MS), or stutters (a frame over STUTTER × cadence and
//    MAX_COUNTED_FRAME_MS) STUTTERS_TO_STOP times in one window.
//  - While a game renders (`body.in-game`, the end screens over a live map),
//    the frame time is mostly the game's, so its steady load is part of the
//    cadence: a card stops when a window averages over IN_GAME_SLOWDOWN ×
//    cadence, never below MIN_FPS_MS and always by IN_GAME_MIN_FPS_MS
//    (8 fps). Frames count up to 4 × cadence there, so the limit can always
//    be reached. No stutter rule.
// A stop holds for that surface (the player card size: "end", "account"…)
// for the rest of the session; other surfaces keep animating.
const CADENCE_FRAMES = 20;
const MIN_FPS_MS = 50;
const IN_GAME_SLOWDOWN = 2;
const IN_GAME_MIN_FPS_MS = 125;
const STUTTER = 4;
const STUTTERS_TO_STOP = 2;
const SLOW_WINDOW_MS = 2000;
// A frame counts for at most this long (in a game, at least STUTTER ×
// cadence), so one long stall (a chunk loading, a GC pause) can't stop a
// card alone.
const MAX_COUNTED_FRAME_MS = 100;
// The flicker schedule repeats after this many seconds.
const FLICKER_LOOP_S = 600;
// The surface of a card outside any <player-card>.
const DEFAULT_SURFACE = "card";

const stoppedSurfaces = new Set<string>();
const live = new Set<CardFx>();

// Whether slow frames stopped animation on this surface for the session.
export function cardFxStopped(surface = DEFAULT_SURFACE): boolean {
  return stoppedSurfaces.has(surface);
}

// Forget every slow-frame stop. The game never does (a stop lasts the
// session); tests do, and so does the cosmetic-preview package, whose
// previewer lets an artist restart after one slow moment. Cards already
// stopped stay still until they are mounted again.
export function resetCardFxSession(): void {
  stoppedSurfaces.clear();
}

// Whether slow frames stopped animation on any surface. The game asks per
// surface; the cosmetic-preview package, which shows one card, asks this.
export function anyCardFxStopped(): boolean {
  return stoppedSurfaces.size > 0;
}

const stopListeners = new Set<(surface: string) => void>();

// Calls `cb` with the surface each time slow frames stop one. Returns the
// unsubscribe. The game doesn't listen; the cosmetic-preview package does.
export function onCardFxSessionStop(cb: (surface: string) => void): () => void {
  stopListeners.add(cb);
  return () => {
    stopListeners.delete(cb);
  };
}

function stopSurface(surface: string): void {
  stoppedSurfaces.add(surface);
  for (const fx of [...live]) if (fx.surface === surface) fx.destroy();
  for (const cb of [...stopListeners]) cb(surface);
}

// A card's surface: the size of the <player-card> it sits in.
export function cardSurface(el: Element): string {
  return (
    el.closest("[data-player-card]")?.getAttribute("data-player-card") ??
    DEFAULT_SURFACE
  );
}

function gameRendering(): boolean {
  return document.body.classList.contains("in-game");
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia(REDUCED_MOTION).matches;
}

const motionSubscribers = new Set<() => void>();
let motionQuery: MediaQueryList | null = null;
const onMotionChange = (): void => {
  for (const cb of [...motionSubscribers]) cb();
};

// Calls `cb` whenever the reduced-motion setting changes. Returns the
// unsubscribe.
export function onReducedMotionChange(cb: () => void): () => void {
  if (typeof matchMedia !== "function") return () => {};
  motionSubscribers.add(cb);
  if (motionQuery === null) {
    motionQuery = matchMedia(REDUCED_MOTION);
    motionQuery.addEventListener("change", onMotionChange);
  }
  return () => {
    motionSubscribers.delete(cb);
    if (motionSubscribers.size === 0 && motionQuery !== null) {
      motionQuery.removeEventListener("change", onMotionChange);
      motionQuery = null;
    }
  };
}

// The effect layers a card should play, or null for a still image: not an
// animated surface, reduced motion, a mask (no shader yet), an animation
// this client can't read, or slow frames stopped this surface.
export function playableAnimation(
  animated: boolean,
  animation: unknown,
  surface = DEFAULT_SURFACE,
): LayerAnimation | null {
  if (!animated || animation === undefined || animation === null) return null;
  if (stoppedSurfaces.has(surface) || prefersReducedMotion()) return null;
  const parsed = LayerAnimationSchema.safeParse(animation);
  return parsed.success ? parsed.data : null;
}

interface MountedLayer {
  layer: FxLayer;
  // The element whose opacity or transform moves.
  move: HTMLElement;
  flashes: Flash[];
}

const FILL =
  "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;";
const COVER = "object-fit:cover;object-position:center;";
// Background art is 2800 × 400.
const ART_ASPECT = 7;
const BAND =
  "linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,0.85),rgba(255,255,255,0))";

// Mounts a background's effect layers into `container` (over the base image)
// and moves them while `host` is on screen and the tab is visible. Call
// start() once the base image has loaded; destroy() when the card goes.
export class CardFx {
  private mounted: MountedLayer[] = [];
  private pending = 0;
  private ready = false;
  private destroyed = false;
  private onScreen = true;
  private observer: IntersectionObserver | null = null;
  private raf: number | null = null;
  private last: number | null = null;
  private t = 0;
  private windowMs = 0;
  private windowFrames = 0;
  private windowStutters = 0;
  // The display's cadence (ms per frame), once measured, and whether a game
  // was rendering when it was.
  private cadence: number | null = null;
  private cadenceInGame = false;
  private intervals: number[] = [];
  private flashes: Flash[] | null = null;

  constructor(
    private readonly host: Element,
    private readonly container: HTMLElement,
    private readonly animation: LayerAnimation,
    // The background's id: seeds flicker so it looks the same everywhere.
    private readonly seed: string,
    // Where the card is shown; a slow-frame stop holds for this surface.
    readonly surface: string = DEFAULT_SURFACE,
  ) {}

  start(): void {
    if (
      this.destroyed ||
      stoppedSurfaces.has(this.surface) ||
      this.mounted.length > 0
    ) {
      return;
    }
    live.add(this);
    this.container.style.visibility = "hidden";
    for (const layer of this.animation.layers) {
      this.container.appendChild(this.mountLayer(layer));
    }
    if (typeof IntersectionObserver === "function") {
      this.onScreen = false;
      this.observer = new IntersectionObserver((entries) => {
        const entry = entries[entries.length - 1];
        if (entry !== undefined) this.onScreen = entry.isIntersecting;
        this.update();
      });
      // The container: the <card-background> host itself has no box.
      this.observer.observe(this.container);
    }
    document.addEventListener("visibilitychange", this.update);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    live.delete(this);
    this.update();
    this.observer?.disconnect();
    this.observer = null;
    document.removeEventListener("visibilitychange", this.update);
    this.container.replaceChildren();
    this.container.style.visibility = "";
    this.mounted = [];
  }

  private image(
    src: string,
    style: string,
    crossOrigin?: "anonymous",
  ): HTMLImageElement {
    const img = document.createElement("img");
    if (crossOrigin !== undefined) img.crossOrigin = crossOrigin;
    img.dataset.cardFxImg = "";
    img.alt = "";
    img.decoding = "async";
    img.setAttribute("style", style);
    this.pending++;
    img.addEventListener("load", this.onLayerLoad, { once: true });
    img.addEventListener("error", this.onLayerError, { once: true });
    img.src = assetUrl(src);
    return img;
  }

  private mountLayer(layer: FxLayer): HTMLElement {
    const strength = layer.strength ?? FX_DEFAULTS.strength;
    const wrap = document.createElement("div");
    wrap.dataset.cardFxLayer = layer.effect;
    wrap.setAttribute("style", `${FILL}overflow:hidden;`);
    let move: HTMLElement = wrap;
    switch (layer.effect) {
      case "pulse":
      case "flicker":
        wrap.appendChild(this.image(layer.src, FILL + COVER));
        wrap.style.opacity = "0";
        break;
      case "drift": {
        // The layer twice, side by side, slid left one art width per period.
        // The copies sit in a box the art's own 7:1 shape, sized and centred
        // like `cover` (so it lines up with the base), and are never cropped
        // themselves: cropped copies would leave a seam where they meet.
        wrap.style.opacity = String(strength);
        wrap.style.setProperty("container-type", "size");
        const box = document.createElement("div");
        box.dataset.cardFxArt = "";
        const w = `max(100cqw, ${ART_ASPECT * 100}cqh)`;
        const h = `max(100cqh, ${100 / ART_ASPECT}cqw)`;
        box.setAttribute(
          "style",
          `position:absolute;width:${w};height:${h};` +
            `left:calc((100cqw - ${w}) / 2);top:calc((100cqh - ${h}) / 2);`,
        );
        move = document.createElement("div");
        move.setAttribute(
          "style",
          "position:absolute;top:0;left:0;height:100%;width:200%;display:flex;will-change:transform;",
        );
        const half = "height:100%;width:50%;flex:none;";
        move.append(this.image(layer.src, half), this.image(layer.src, half));
        box.appendChild(move);
        wrap.appendChild(box);
        break;
      }
      case "shimmer": {
        // The layer is a static mask; a soft band moves underneath it, so
        // the band shows only where the layer has pixels.
        const url = `url("${assetUrl(layer.src)}")`;
        for (const prefix of ["", "-webkit-"]) {
          wrap.style.setProperty(`${prefix}mask-image`, url);
          wrap.style.setProperty(`${prefix}mask-size`, "cover");
          wrap.style.setProperty(`${prefix}mask-position`, "center");
          wrap.style.setProperty(`${prefix}mask-repeat`, "no-repeat");
        }
        // Hidden: only tells us whether the layer loaded. Fetched with CORS,
        // as the mask is, so a CDN that refuses the mask fails this too and
        // the card stays on its base rather than showing an empty band.
        const check = this.image(layer.src, "display:none;", "anonymous");
        wrap.appendChild(check);
        // Sized and moved in container units (see shimmerBand).
        wrap.style.setProperty("container-type", "size");
        // The angle is fixed per layer, so the length is too.
        const { lengthW, lengthH } = shimmerBand(0, layer);
        const length = `${(lengthW * 100).toFixed(2)}cqw + ${(lengthH * 100).toFixed(2)}cqh`;
        move = document.createElement("div");
        move.setAttribute(
          "style",
          `position:absolute;left:0;top:calc(50cqh - (${length}) / 2);` +
            `height:calc(${length});width:${SHIMMER_BAND_WIDTH * 100}cqw;` +
            `opacity:${strength};will-change:transform;background:${BAND};`,
        );
        wrap.appendChild(move);
        break;
      }
    }
    move.dataset.cardFxMove = "";
    this.mounted.push({
      layer,
      move,
      flashes: layer.effect === "flicker" ? this.cardFlashes() : [],
    });
    return wrap;
  }

  // Every flicker layer on a card shares one schedule, at the card's fastest
  // rate: the 3-flashes-a-second cap is about what the eye sees on the whole
  // card, not per layer.
  private cardFlashes(): Flash[] {
    if (this.flashes === null) {
      const rates = this.animation.layers
        .filter((l) => l.effect === "flicker")
        .map((l) => l.rate ?? FX_DEFAULTS.rate);
      const rate = (["high", "medium", "low"] as const).find((r) =>
        rates.includes(r),
      )!;
      this.flashes = flickerSchedule(this.seed, rate, FLICKER_LOOP_S);
    }
    return this.flashes;
  }

  private onLayerLoad = (): void => {
    if (this.destroyed) return;
    this.pending--;
    if (this.pending > 0) return;
    this.ready = true;
    this.apply();
    this.container.style.visibility = "";
    this.update();
  };

  // Any layer failing leaves the card on its base image.
  private onLayerError = (): void => {
    this.destroy();
  };

  private update = (): void => {
    const run =
      this.ready &&
      !this.destroyed &&
      !stoppedSurfaces.has(this.surface) &&
      this.onScreen &&
      !document.hidden;
    if (run && this.raf === null) {
      this.raf = requestAnimationFrame(this.tick);
    } else if (!run && this.raf !== null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
      // A pause isn't a slow frame: timing and the frame window restart,
      // and the display may come back at another rate, so measure again.
      this.last = null;
      this.remeasure();
    }
  };

  private remeasure(): void {
    this.cadence = null;
    this.intervals = [];
    this.resetWindow();
  }

  private resetWindow(): void {
    this.windowMs = 0;
    this.windowFrames = 0;
    this.windowStutters = 0;
  }

  // Counts one frame interval; true when this surface should stop.
  private tooSlow(dt: number): boolean {
    const inGame = gameRendering();
    // A game started or ended under the card: measure again.
    if (this.cadence !== null && inGame !== this.cadenceInGame) {
      this.remeasure();
    }
    if (this.cadence === null) {
      this.intervals.push(Math.min(dt, MAX_COUNTED_FRAME_MS));
      if (this.intervals.length >= CADENCE_FRAMES) {
        this.cadence = median(this.intervals);
        this.cadenceInGame = inGame;
        this.intervals = [];
      }
      return false;
    }
    const cap = inGame
      ? Math.max(MAX_COUNTED_FRAME_MS, STUTTER * this.cadence)
      : MAX_COUNTED_FRAME_MS;
    this.windowMs += Math.min(dt, cap);
    this.windowFrames++;
    if (
      !inGame &&
      dt > Math.max(STUTTER * this.cadence, MAX_COUNTED_FRAME_MS)
    ) {
      this.windowStutters++;
    }
    if (this.windowMs < SLOW_WINDOW_MS) return false;
    const average = this.windowMs / this.windowFrames;
    const limit = inGame
      ? Math.min(
          Math.max(MIN_FPS_MS, IN_GAME_SLOWDOWN * this.cadence),
          IN_GAME_MIN_FPS_MS,
        )
      : MIN_FPS_MS;
    const slow = average > limit || this.windowStutters >= STUTTERS_TO_STOP;
    this.resetWindow();
    return slow;
  }

  private tick = (now: number): void => {
    this.raf = null;
    if (this.last !== null) {
      const dt = now - this.last;
      this.t += dt / 1000;
      if (this.tooSlow(dt)) {
        stopSurface(this.surface);
        return;
      }
    }
    this.last = now;
    this.apply();
    this.update();
  };

  private apply(): void {
    const t = this.t;
    for (const { layer, move, flashes } of this.mounted) {
      const strength = layer.strength ?? FX_DEFAULTS.strength;
      switch (layer.effect) {
        case "pulse":
          move.style.opacity = pulseOpacity(t, layer).toFixed(3);
          break;
        case "flicker":
          move.style.opacity = flickerOn(t, flashes, FLICKER_LOOP_S)
            ? String(strength)
            : "0";
          break;
        case "drift": {
          // The strip is two card widths, so 50% of it is one card.
          const x = -driftOffset(t, layer) * 50;
          move.style.transform = `translateX(${x.toFixed(3)}%)`;
          break;
        }
        case "shimmer": {
          // The band's left edge sits half a band left of its centre.
          const b = shimmerBand(t, layer);
          const w = ((b.centreW - SHIMMER_BAND_WIDTH / 2) * 100).toFixed(2);
          const h = (b.centreH * 100).toFixed(2);
          move.style.transform = `translateX(calc(${w}cqw + ${h}cqh)) rotate(${b.angle}deg)`;
          break;
        }
      }
    }
  }
}
