import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { resetCardFxSession } from "../../src/client/components/card/CardFx";
import type { PlayerCard } from "../../src/client/components/card/PlayerCard";
import type { CardPreviewSize } from "../../src/client/cosmetic-preview/api";
import {
  CARD_PREVIEW_SIZES,
  cardPreviewModule,
} from "../../src/client/cosmetic-preview/card";

const {
  mountCardBackgroundPreview,
  onCardAnimationStopped,
  restartCardAnimation,
} = cardPreviewModule;

const BLOB =
  "blob:https://dashboard.example/0b7c4d1e-1111-4222-8333-944455556666";
const LAYER =
  "blob:https://dashboard.example/aaaaaaaa-1111-4222-8333-944455556666";

const ANIMATION = {
  kind: "layers",
  layers: [
    { src: LAYER, effect: "pulse", period: 2 },
    { src: LAYER, effect: "drift", period: 60 },
  ],
};

const ANIMATED: CardPreviewSize[] = ["inventory", "large", "endScreen"];
const STILL: CardPreviewSize[] = ["store", "lobbyTag", "hover", "panel"];

function card(host: HTMLElement): PlayerCard | null {
  return host.querySelector<PlayerCard>("player-card");
}

describe("mountCardBackgroundPreview", () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
  });
  afterEach(() => {
    document.body.innerHTML = "";
    resetCardFxSession();
  });

  test("every size the plan lists is offered", () => {
    expect([...CARD_PREVIEW_SIZES].sort()).toEqual(
      [...ANIMATED, ...STILL].sort(),
    );
  });

  test.each(ANIMATED)("%s: an animated card, as the game draws it", (size) => {
    const { result } = mountCardBackgroundPreview(
      host,
      { url: BLOB, animation: ANIMATION },
      { size, animated: true, name: "Artist" },
    );
    expect(result).toEqual({ ok: true });
    const el = card(host)!;
    expect(el.animated).toBe(true);
    expect(el.size).toBe(size === "endScreen" ? "end" : "account");
    expect(el.view?.background?.url).toBe(BLOB);
    expect(el.view?.background?.animation).toEqual(ANIMATION);
    expect(el.view?.username).toBe("Artist");
    // A sample name and stats sit on the card.
    expect(el.view?.trackers.length).toBeGreaterThan(0);
  });

  test.each(["store", "panel"] as const)(
    "%s: a still card, whatever the switch says",
    (size) => {
      mountCardBackgroundPreview(
        host,
        { url: BLOB, animation: ANIMATION },
        { size, animated: true },
      );
      const el = card(host)!;
      expect(el.animated).toBe(false);
      expect(el.size).toBe(size === "store" ? "thumb" : "panel");
    },
  );

  test.each(["lobbyTag", "hover"] as const)(
    "%s: the still backdrop the game puts behind text",
    (size) => {
      mountCardBackgroundPreview(
        host,
        { url: BLOB, animation: ANIMATION },
        { size, animated: true, name: "Artist" },
      );
      expect(card(host)).toBeNull();
      const backdrop = host.querySelector<HTMLElement>(
        "[data-card-preview-backdrop]",
      )!;
      // The blob: URL reaches the CSS untouched (buildAssetUrl passes it).
      expect(backdrop.getAttribute("style")).toContain(BLOB);
      expect(host.textContent).toContain("Artist");
      expect(host.querySelector("[data-card-fx]")).toBeNull();
    },
  );

  test("the hover summary and panel keep the game's width in any layout", () => {
    // Their host may be a flex item that would otherwise shrink them to the text.
    for (const [size, width] of [
      ["hover", "500px"],
      ["panel", "368px"],
    ] as const) {
      const el = document.createElement("div");
      document.body.append(el);
      mountCardBackgroundPreview(el, { url: BLOB }, { size, animated: true });
      const wrapper = el.querySelector<HTMLElement>("[data-card-preview]")!;
      expect(wrapper.style.width).toBe(width);
      expect(wrapper.style.maxWidth).toBe("100%");
    }
  });

  test("motion off: the large views are still too", () => {
    for (const size of ANIMATED) {
      const el = document.createElement("div");
      document.body.append(el);
      mountCardBackgroundPreview(
        el,
        { url: BLOB, animation: ANIMATION },
        { size, animated: false },
      );
      expect(card(el)!.animated).toBe(false);
    }
  });

  test("the blob: base URL reaches the card's image unchanged", async () => {
    mountCardBackgroundPreview(
      host,
      { url: BLOB, animation: ANIMATION },
      { size: "large", animated: true },
    );
    const el = card(host)!;
    await el.updateComplete;
    const bg = host.querySelector<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("card-background")!;
    await bg.updateComplete;
    const img = host.querySelector<HTMLImageElement>("[data-card-bg-base]")!;
    expect(img.getAttribute("src")).toBe(BLOB);
  });

  test("hidden layers are left out of the animation", () => {
    const { handle } = mountCardBackgroundPreview(
      host,
      { url: BLOB, animation: ANIMATION },
      { size: "large", animated: true, hiddenLayers: [0] },
    );
    const animation = card(host)!.view!.background!.animation as {
      layers: { effect: string }[];
    };
    const layers = animation.layers;
    expect(layers.map((l) => l.effect)).toEqual(["drift"]);
    handle.update(
      { url: BLOB, animation: ANIMATION },
      { size: "large", animated: true, hiddenLayers: [0, 1] },
    );
    expect(card(host)!.view?.background?.animation).toBeUndefined();
  });

  test("refuses URLs that aren't https:, blob: or data:image", () => {
    for (const url of [
      "javascript:alert(1)",
      "http://evil.example/a.webp",
      "data:text/html,<b>",
      "",
    ]) {
      const el = document.createElement("div");
      el.append(document.createElement("p"));
      const { result } = mountCardBackgroundPreview(
        el,
        { url },
        { size: "large", animated: true },
      );
      expect(result.ok).toBe(false);
      // An invalid first request leaves the host alone.
      expect(el.firstElementChild?.tagName).toBe("P");
    }
    // Localhost over http is a dashboard's own dev server.
    expect(
      mountCardBackgroundPreview(
        host,
        { url: "http://localhost:3000/api/x.webp" },
        { size: "large", animated: true },
      ).result.ok,
    ).toBe(true);
  });

  test("a layer src must be a URL it can load too", () => {
    const { result } = mountCardBackgroundPreview(
      host,
      {
        url: BLOB,
        animation: {
          kind: "layers",
          layers: [{ src: "javascript:alert(1)", effect: "pulse" }],
        },
      },
      { size: "large", animated: true },
    );
    expect(result.ok).toBe(false);
  });

  test("settings the game would refuse: an error, and the still base", () => {
    const { result } = mountCardBackgroundPreview(
      host,
      {
        url: BLOB,
        animation: {
          kind: "layers",
          layers: [{ src: LAYER, effect: "pulse", period: 99 }],
        },
      },
      { size: "large", animated: true },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("period");
    const el = card(host)!;
    expect(el.view?.background?.url).toBe(BLOB);
    expect(el.view?.background?.animation).toBeUndefined();
  });

  test("update() keeps the card element; destroy() is final", () => {
    const { handle } = mountCardBackgroundPreview(
      host,
      { url: BLOB },
      { size: "large", animated: true },
    );
    const first = card(host);
    expect(
      handle.update(
        { url: BLOB, animation: ANIMATION },
        { size: "large", animated: false },
      ),
    ).toEqual({ ok: true });
    expect(card(host)).toBe(first);
    expect(first!.animated).toBe(false);

    handle.destroy();
    expect(host.children).toHaveLength(0);
    const after = document.createElement("p");
    host.append(after);
    expect(
      handle.update({ url: BLOB }, { size: "large", animated: true }).ok,
    ).toBe(false);
    expect(host.firstElementChild).toBe(after);
  });

  test("the safe-area overlay marks the centre 1260 × 290 of the art", () => {
    const { handle } = mountCardBackgroundPreview(
      host,
      { url: BLOB },
      { size: "large", animated: true, safeArea: true },
    );
    const box = host.querySelector<HTMLElement>("[data-card-safe-area]")!;
    const style = box.getAttribute("style")!;
    // 1260 of 2800 wide and 290 of 400 high, of the art as drawn.
    expect(style).toContain("calc(max(100cqw, 700cqh) * 0.45)");
    expect(style).toContain("calc(max(100cqh, 14.2857cqw) * 0.725)");
    handle.update({ url: BLOB }, { size: "large", animated: true });
    expect(host.querySelector("[data-card-safe-area]")).toBeNull();
  });

  test("restart after a slow-frame stop mounts the cards afresh", () => {
    const heard: number[] = [];
    const unsubscribe = onCardAnimationStopped(() => heard.push(1));
    mountCardBackgroundPreview(
      host,
      { url: BLOB, animation: ANIMATION },
      { size: "large", animated: true },
    );
    const before = card(host);
    restartCardAnimation();
    const after = card(host);
    expect(after).not.toBe(before);
    expect(after!.animated).toBe(true);
    unsubscribe();
    expect(heard).toEqual([]);
  });

  test("restart leaves out, and forgets, a preview dropped without destroy()", () => {
    const gone = document.createElement("div");
    document.body.append(gone);
    mountCardBackgroundPreview(
      gone,
      { url: BLOB, animation: ANIMATION },
      { size: "large", animated: true },
    );
    const before = card(gone);
    gone.remove();
    restartCardAnimation();
    expect(card(gone)).toBe(before);
    // Forgotten: put back, it is still not remounted.
    document.body.append(gone);
    restartCardAnimation();
    expect(card(gone)).toBe(before);
  });

  test("restart keeps a preview mounted before its host is on the page", () => {
    const later = document.createElement("div");
    mountCardBackgroundPreview(
      later,
      { url: BLOB, animation: ANIMATION },
      { size: "large", animated: true },
    );
    const before = card(later);
    restartCardAnimation();
    expect(card(later)).toBe(before);
    document.body.append(later);
    restartCardAnimation();
    expect(card(later)).not.toBe(before);
  });

  test("a size is one of its own, not an inherited key", () => {
    for (const size of ["toString", "constructor", "__proto__"]) {
      const { result } = mountCardBackgroundPreview(
        host,
        { url: BLOB },
        { size: size as CardPreviewSize, animated: true },
      );
      expect(result).toEqual({ ok: false, error: `Unknown size: ${size}` });
    }
  });
});
