import { html, LitElement } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";

// Stubbed before the modules under test create their shared observer.
class FakeIntersectionObserver {
  static instance: FakeIntersectionObserver | null = null;
  readonly observed = new Set<Element>();
  constructor(readonly callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instance = this;
  }
  observe(element: Element) {
    this.observed.add(element);
  }
  unobserve(element: Element) {
    this.observed.delete(element);
  }
  disconnect() {
    this.observed.clear();
  }
  takeRecords() {
    return [];
  }
}
vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

import type { ResolvedCosmetic } from "../../src/client/Cosmetics";
import "../../src/client/components/CosmeticPreview";
import type { CosmeticPreview } from "../../src/client/components/CosmeticPreview";
import { ProgressiveList } from "../../src/client/components/ProgressiveList";

function report(element: Element, near: boolean) {
  const io = FakeIntersectionObserver.instance!;
  expect(io.observed.has(element)).toBe(true);
  io.callback(
    [{ target: element, isIntersecting: near } as IntersectionObserverEntry],
    io as unknown as IntersectionObserver,
  );
}

// A 2×2 tile, scale 0: primary on the diagonal, secondary off it.
const checker: ResolvedCosmetic = {
  type: "pattern",
  cosmetic: { name: "checker", pattern: "AAAABg", rarity: "rare" },
  colorPalette: {
    name: "red",
    primaryColor: "#ff0000",
    secondaryColor: "#0000ff",
  },
  relationship: "owned",
  key: "pattern:checker:red",
} as unknown as ResolvedCosmetic;

const subscription: ResolvedCosmetic = {
  type: "subscription",
  cosmetic: {
    name: "gold",
    hardCurrencySignupBonus: 100,
    dailyHardCurrency: 10,
    unlimitedRanked: false,
    canCreatePublicLobbies: false,
  },
  colorPalette: null,
  relationship: "purchasable",
  key: "subscription:gold",
} as unknown as ResolvedCosmetic;

async function mountPreview(
  resolved: ResolvedCosmetic,
  size: "card" | "detail" = "card",
): Promise<CosmeticPreview> {
  const preview = document.createElement("cosmetic-preview") as CosmeticPreview;
  preview.resolved = resolved;
  preview.size = size;
  document.body.appendChild(preview);
  await preview.updateComplete;
  return preview;
}

describe("lazy cosmetic previews", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("paints a card pattern only while it is near the screen", async () => {
    const preview = await mountPreview(checker);
    expect(preview.querySelector("[data-cosmetic-preview]")).toBeTruthy();
    expect(preview.querySelector("canvas")).toBeNull();

    report(preview, true);
    await preview.updateComplete;
    const canvas = preview.querySelector("canvas")!;
    expect(canvas.width).toBe(150);
    // vitest-canvas-mock can't read pixels back; check what was painted.
    const ctx = canvas.getContext("2d")!;
    const [painted] = vi.mocked(ctx.putImageData).mock.calls[0];
    const pixels = painted.data;
    expect([...pixels.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...pixels.slice(4, 8)]).toEqual([0, 0, 255, 255]);

    report(preview, false);
    await preview.updateComplete;
    expect(preview.querySelector("canvas")).toBeNull();
  });

  it("stops observing once removed", async () => {
    const preview = await mountPreview(checker);
    preview.remove();
    expect(FakeIntersectionObserver.instance!.observed.has(preview)).toBe(
      false,
    );
  });

  it("renders detail previews and text previews without waiting", async () => {
    const detail = await mountPreview(checker, "detail");
    expect(detail.querySelector("canvas")).toBeTruthy();

    const perks = await mountPreview(subscription);
    expect(perks.querySelector("plutonium-icon")).toBeTruthy();
  });
});

class PagedHost extends LitElement {
  items: number[] = Array.from({ length: 100 }, (_, i) => i);
  search = "";
  readonly pages = new ProgressiveList(this, 40);

  createRenderRoot() {
    return this;
  }

  render() {
    const page = this.pages.page("test-list", this.search, this.items);
    return html`<div>
      ${page.items.map((i) => html`<span data-item=${i}></span>`)}${page.more}
    </div>`;
  }
}
customElements.define("paged-host", PagedHost);

describe("ProgressiveList", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  const count = (host: PagedHost) =>
    host.querySelectorAll("[data-item]").length;
  const sentinel = (host: PagedHost) =>
    host.querySelector('[data-progressive-sentinel="test-list"]');

  it("grows a page each time the sentinel nears the screen", async () => {
    const host = document.createElement("paged-host") as PagedHost;
    document.body.appendChild(host);
    await host.updateComplete;
    expect(count(host)).toBe(40);

    report(sentinel(host)!, true);
    await host.updateComplete;
    expect(count(host)).toBe(80);

    // A sentinel reported far away grows nothing.
    report(sentinel(host)!, false);
    await host.updateComplete;
    expect(count(host)).toBe(80);

    report(sentinel(host)!, true);
    await host.updateComplete;
    expect(count(host)).toBe(100);
    expect(sentinel(host)).toBeNull();
  });

  it("starts over on a new key and on reset", async () => {
    const host = document.createElement("paged-host") as PagedHost;
    document.body.appendChild(host);
    await host.updateComplete;
    report(sentinel(host)!, true);
    await host.updateComplete;
    expect(count(host)).toBe(80);

    host.search = "a";
    host.requestUpdate();
    await host.updateComplete;
    expect(count(host)).toBe(40);

    report(sentinel(host)!, true);
    await host.updateComplete;
    expect(count(host)).toBe(80);
    host.pages.reset();
    host.requestUpdate();
    await host.updateComplete;
    expect(count(host)).toBe(40);
  });
});
