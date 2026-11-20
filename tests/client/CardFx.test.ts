import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CardBackground } from "../../src/client/components/card/CardBackground";
import {
  cardFxStopped,
  resetCardFxSession,
  shimmerBand,
} from "../../src/client/components/card/CardFx";
import type { PlayerCardView } from "../../src/client/components/card/PlayerCardModel";

if (!customElements.get("card-background")) {
  customElements.define("card-background", CardBackground);
}

function fixture(name: string): NonNullable<PlayerCardView["background"]> {
  const raw = JSON.parse(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "testdata",
        "card-backgrounds",
        `${name}.json`,
      ),
      "utf8",
    ),
  ) as { name: string; url: string; rarity: string; animation: unknown };
  return {
    name: raw.name,
    url: raw.url,
    rarity: raw.rarity,
    animation: raw.animation,
  };
}

const NEON = fixture("neon-grid");
const STORM = fixture("storm-front");
const REACTOR = fixture("reactor-core");
const SHIMMER: NonNullable<PlayerCardView["background"]> = {
  name: "bg_shimmer",
  url: "/cosmetics/bg_shimmer.webp",
  rarity: "rare",
  animation: {
    kind: "layers",
    layers: [{ src: "/fx-shimmer.png", effect: "shimmer", angle: 30 }],
  },
};

// Fakes for the browser APIs the controller uses.
let rafCallbacks: Map<number, FrameRequestCallback>;
let nextRaf: number;
let reducedMotion: boolean;
let observers: FakeObserver[];
let motionListeners: Set<() => void>;

function setReducedMotion(on: boolean) {
  reducedMotion = on;
  for (const l of [...motionListeners]) l();
}

class FakeObserver {
  observed: Element[] = [];
  disconnected = false;
  constructor(public callback: IntersectionObserverCallback) {
    observers.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  report(isIntersecting: boolean) {
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  resetCardFxSession();
  rafCallbacks = new Map();
  nextRaf = 1;
  reducedMotion = false;
  observers = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    const id = nextRaf++;
    rafCallbacks.set(id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    rafCallbacks.delete(id);
  });
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  motionListeners = new Set();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return query.includes("reduce") && reducedMotion;
    },
    media: query,
    addEventListener(_: string, l: () => void) {
      motionListeners.add(l);
    },
    removeEventListener(_: string, l: () => void) {
      motionListeners.delete(l);
    },
  }));
  setHidden(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setHidden(false);
});

async function mount(
  background: PlayerCardView["background"],
  animated = true,
): Promise<CardBackground> {
  const el = document.createElement("card-background") as CardBackground;
  el.background = background;
  el.animated = animated;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const layerEls = (el: Element) =>
  el.querySelectorAll<HTMLElement>("[data-card-fx-layer]");
const layerImgs = (el: Element) => [
  ...el.querySelectorAll<HTMLImageElement>("[data-card-fx-img]"),
];

function loadBase(el: Element) {
  el.querySelector("[data-card-bg-base]")!.dispatchEvent(new Event("load"));
}
function loadLayers(el: Element) {
  for (const img of layerImgs(el)) img.dispatchEvent(new Event("load"));
}
// Runs one frame at `now` ms.
function frame(now: number) {
  const pending = [...rafCallbacks.entries()];
  rafCallbacks.clear();
  for (const [, cb] of pending) cb(now);
}

describe("<card-background> effect layers", () => {
  it("stays still when not animated", async () => {
    const el = await mount(NEON, false);
    loadBase(el);
    await el.updateComplete;
    expect(layerEls(el)).toHaveLength(0);
  });

  it("stays still for a mask animation", async () => {
    const el = await mount(REACTOR);
    loadBase(el);
    await el.updateComplete;
    expect(layerEls(el)).toHaveLength(0);
    expect(el.querySelector("[data-card-bg-base]")).not.toBeNull();
  });

  it("stays still under reduced motion", async () => {
    reducedMotion = true;
    const el = await mount(NEON);
    loadBase(el);
    await el.updateComplete;
    expect(layerEls(el)).toHaveLength(0);
  });

  it("stays still with no animation", async () => {
    const el = await mount({ ...NEON, animation: undefined });
    loadBase(el);
    await el.updateComplete;
    expect(layerEls(el)).toHaveLength(0);
  });

  it("mounts layers only after the base image loads", async () => {
    const el = await mount(NEON);
    expect(layerEls(el)).toHaveLength(0);
    loadBase(el);
    await el.updateComplete;
    const layers = [...layerEls(el)];
    expect(layers.map((l) => l.dataset.cardFxLayer)).toEqual([
      "pulse",
      "drift",
    ]);
    // Drift draws its layer twice, side by side.
    expect(layerImgs(el)).toHaveLength(3);
    expect(layerImgs(el)[0].getAttribute("src")).toContain(
      "bg_neon-grid_fx-pulse.png",
    );
  });

  it("drift tiles whole copies of the art, so the loop has no seam", async () => {
    const el = await mount(NEON);
    loadBase(el);
    await el.updateComplete;
    const drift = el.querySelector<HTMLElement>("[data-card-fx-layer=drift]")!;
    // The strip sits in a box the art's own shape (cropped like the base),
    // and each copy fills its half uncropped.
    const box = drift.querySelector<HTMLElement>("[data-card-fx-art]");
    expect(box).not.toBeNull();
    const strip = box!.querySelector<HTMLElement>("[data-card-fx-move]")!;
    const copies = [...strip.querySelectorAll<HTMLImageElement>("img")];
    expect(copies).toHaveLength(2);
    for (const img of copies) expect(img.style.objectFit).not.toBe("cover");
  });

  it("drops every layer when one fails, keeping the base", async () => {
    const el = await mount(STORM);
    loadBase(el);
    await el.updateComplete;
    expect(layerEls(el)).toHaveLength(2);
    layerImgs(el)[0].dispatchEvent(new Event("load"));
    layerImgs(el)[1].dispatchEvent(new Event("error"));
    expect(layerEls(el)).toHaveLength(0);
    expect(el.querySelector("[data-card-bg-base]")).not.toBeNull();
    expect(rafCallbacks.size).toBe(0);
  });

  it("animates only once every layer has loaded and the card is on screen", async () => {
    const el = await mount(NEON);
    loadBase(el);
    await el.updateComplete;
    expect(rafCallbacks.size).toBe(0);
    loadLayers(el);
    // Not reported on screen yet.
    expect(rafCallbacks.size).toBe(0);
    observers[0].report(true);
    // The container, not the zero-size <card-background> host.
    expect(observers[0].observed).toEqual([el.querySelector("[data-card-fx]")]);
    expect(rafCallbacks.size).toBe(1);
  });

  it("pauses off screen and while the tab is hidden", async () => {
    const el = await mount(NEON);
    loadBase(el);
    await el.updateComplete;
    loadLayers(el);
    observers[0].report(false);
    expect(rafCallbacks.size).toBe(0);
    observers[0].report(true);
    expect(rafCallbacks.size).toBe(1);
    setHidden(true);
    expect(rafCallbacks.size).toBe(0);
    setHidden(false);
    expect(rafCallbacks.size).toBe(1);
  });

  it("moves layers with opacity and transform only", async () => {
    const el = await mount(NEON);
    loadBase(el);
    await el.updateComplete;
    loadLayers(el);
    observers[0].report(true);
    frame(1000);
    frame(2200);
    const [pulse, drift] = [...layerEls(el)];
    // 1.2 s into a 2.4 s pulse: the top of the range.
    expect(Number(pulse.style.opacity)).toBeCloseTo(1, 1);
    const strip = drift.querySelector<HTMLElement>("[data-card-fx-move]")!;
    expect(strip.style.transform).toMatch(/^translateX\(-[\d.]+%\)$/);
  });

  it("shimmer: the band moves under a mask of the layer", async () => {
    const el = await mount(SHIMMER);
    loadBase(el);
    await el.updateComplete;
    const [layer] = [...layerEls(el)];
    expect(layer.style.getPropertyValue("mask-image")).toContain(
      "fx-shimmer.png",
    );
    loadLayers(el);
    observers[0].report(true);
    frame(0);
    frame(500);
    const band = layer.querySelector<HTMLElement>("[data-card-fx-move]")!;
    expect(band.style.transform).toContain("rotate(30deg)");
    // Both of shimmerBand's centre terms move the band sideways; there is no
    // vertical move (see the centreH test in CardFxMaths).
    expect(band.style.transform).toMatch(
      /^translateX\(calc\(-?[\d.]+cqw [+-] -?[\d.]+cqh\)\) rotate\(30deg\)$/,
    );
  });

  it("shimmer: a steep band is as long as shimmerBand says", async () => {
    const steep = {
      src: "/fx-shimmer.png",
      effect: "shimmer" as const,
      angle: 80,
    };
    const el = await mount({
      ...SHIMMER,
      animation: { kind: "layers", layers: [steep] },
    });
    loadBase(el);
    await el.updateComplete;
    const band = el.querySelector<HTMLElement>("[data-card-fx-move]")!;
    const { lengthW, lengthH } = shimmerBand(0, steep);
    const length = `${(lengthW * 100).toFixed(2)}cqw + ${(lengthH * 100).toFixed(2)}cqh`;
    expect(band.getAttribute("style")).toContain(`height:calc(${length})`);
    expect(band.getAttribute("style")).toContain(
      `top:calc(50cqh - (${length}) / 2)`,
    );
  });

  it("stops for the session after 2 s of slow frames", async () => {
    const el = await mount(NEON);
    loadBase(el);
    await el.updateComplete;
    loadLayers(el);
    observers[0].report(true);
    for (let now = 0; now <= 2200; now += 40) frame(now);
    expect(cardFxStopped()).toBe(true);
    expect(layerEls(el)).toHaveLength(0);
    expect(rafCallbacks.size).toBe(0);

    const next = await mount(STORM);
    loadBase(next);
    await next.updateComplete;
    expect(layerEls(next)).toHaveLength(0);
  });

  it("stops a ~40 ms device that also hitches over 250 ms every 1.2 s", async () => {
    const el = await mount(NEON);
    loadBase(el);
    await el.updateComplete;
    loadLayers(el);
    observers[0].report(true);
    let now = 0;
    frame(now);
    for (let i = 0; i < 400 && !cardFxStopped(); i++) {
      now += i % 30 === 29 ? 300 : 40;
      frame(now);
    }
    expect(cardFxStopped()).toBe(true);
    expect(layerEls(el)).toHaveLength(0);
  });

  it("stops a device under 4 fps", async () => {
    const el = await mount(NEON);
    loadBase(el);
    await el.updateComplete;
    loadLayers(el);
    observers[0].report(true);
    for (let now = 0; now <= 60_000 && !cardFxStopped(); now += 300) {
      frame(now);
    }
    expect(cardFxStopped()).toBe(true);
  });

  it("one long stall doesn't stop the session", async () => {
    const el = await mount(NEON);
    loadBase(el);
    await el.updateComplete;
    loadLayers(el);
    observers[0].report(true);
    frame(0);
    frame(1000); // e.g. a chunk loading while the modal opens
    for (let now = 1016; now <= 4000; now += 16) frame(now);
    expect(cardFxStopped()).toBe(false);
    expect(layerEls(el)).toHaveLength(2);
  });

  it("flicker layers on one card flash together, so the card keeps the cap", async () => {
    const el = await mount({
      name: "bg_two_flickers",
      url: "/cosmetics/bg_two.webp",
      rarity: "rare",
      animation: {
        kind: "layers",
        layers: [
          { src: "/a.png", effect: "flicker", rate: "high" },
          { src: "/b.png", effect: "flicker", rate: "low" },
        ],
      },
    });
    loadBase(el);
    await el.updateComplete;
    loadLayers(el);
    observers[0].report(true);
    const [a, b] = [...layerEls(el)];
    let onFrames = 0;
    for (let now = 0; now <= 60_000; now += 10) {
      frame(now);
      expect(a.style.opacity).toBe(b.style.opacity);
      if (a.style.opacity !== "0") onFrames++;
    }
    // The faster rate wins: a "high" card flashes at least every 2 s or so.
    expect(onFrames).toBeGreaterThan(150);
  });

  it("shimmer checks its layer with CORS, like the mask fetch", async () => {
    const el = await mount(SHIMMER);
    loadBase(el);
    await el.updateComplete;
    expect(layerImgs(el)[0].crossOrigin).toBe("anonymous");
  });

  it("follows reduced motion turning on and off", async () => {
    const el = await mount(NEON);
    loadBase(el);
    await el.updateComplete;
    loadLayers(el);
    observers[0].report(true);
    expect(rafCallbacks.size).toBe(1);
    setReducedMotion(true);
    await el.updateComplete;
    expect(layerEls(el)).toHaveLength(0);
    expect(rafCallbacks.size).toBe(0);
    setReducedMotion(false);
    await el.updateComplete;
    expect(layerEls(el)).toHaveLength(2);
    el.remove();
    expect(motionListeners.size).toBe(0);
  });

  it("restarts when the animation changes under the same name and url", async () => {
    const el = await mount(NEON);
    loadBase(el);
    await el.updateComplete;
    expect(layerEls(el)).toHaveLength(2);
    el.background = {
      ...NEON,
      animation: {
        kind: "layers",
        layers: [{ src: "/fx-shimmer.png", effect: "shimmer" }],
      },
    };
    await el.updateComplete;
    expect([...layerEls(el)].map((l) => l.dataset.cardFxLayer)).toEqual([
      "shimmer",
    ]);
  });

  it("keeps going at a normal frame rate", async () => {
    const el = await mount(NEON);
    loadBase(el);
    await el.updateComplete;
    loadLayers(el);
    observers[0].report(true);
    for (let now = 0; now <= 4000; now += 16) frame(now);
    expect(cardFxStopped()).toBe(false);
    expect(layerEls(el)).toHaveLength(2);
    expect(rafCallbacks.size).toBe(1);
  });

  it("cleans up when removed", async () => {
    const el = await mount(NEON);
    loadBase(el);
    await el.updateComplete;
    loadLayers(el);
    observers[0].report(true);
    expect(rafCallbacks.size).toBe(1);
    el.remove();
    expect(rafCallbacks.size).toBe(0);
    expect(observers[0].disconnected).toBe(true);
    // Visibility changes after removal schedule nothing.
    setHidden(true);
    setHidden(false);
    expect(rafCallbacks.size).toBe(0);
  });

  it("restarts the layers when the background changes", async () => {
    const el = await mount(NEON);
    loadBase(el);
    await el.updateComplete;
    expect(layerEls(el)).toHaveLength(2);
    el.background = STORM;
    await el.updateComplete;
    // The new base hasn't loaded yet.
    expect(layerEls(el)).toHaveLength(0);
    loadBase(el);
    await el.updateComplete;
    expect([...layerEls(el)].map((l) => l.dataset.cardFxLayer)).toEqual([
      "flicker",
      "drift",
    ]);
  });
});
