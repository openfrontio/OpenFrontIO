import {
  GameMapType,
  listedMaps,
  MapInfo,
  maps,
} from "@openfront/engine-api/game/GameTypes";
import { MapManifest } from "@openfront/engine-api/game/MapManifest";
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../resources/lang/en.json";
import type { AtlasMap } from "../../src/client/components/map/AtlasMap";
import "../../src/client/components/map/AtlasMap";
import {
  type MapDetails,
  type MapStats,
  mapStats,
} from "../../src/client/components/map/MapDetails";

function manifest(folder: string): MapManifest {
  return JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, `../../resources/maps/${folder}/manifest.json`),
      "utf8",
    ),
  );
}

// The public lobby sizes MapPlaylist deals for Lemnos are 45, 35 and 25.
describe("mapStats", () => {
  it("sums up a map's size, land, nations and full lobby size", () => {
    expect(mapStats(manifest("lemnos"))).toEqual({
      width: 1748,
      height: 1420,
      landPercent: 35,
      nations: 9,
      players: 45,
    });
  });
});

describe("<atlas-map>", () => {
  let atlas: AtlasMap;
  let frame: HTMLElement;
  let selected: GameMapType[];
  let scrolled: Element[];

  beforeEach(async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            '<svg><path id="sphere" d="M0 0h10v10H0z"/><path id="land" d="M0 0l10 0 0 10z"/></svg>',
          ),
      ),
    );
    selected = [];
    atlas = document.createElement("atlas-map") as AtlasMap;
    atlas.onSelectMap = (map) => selected.push(map);
    document.body.appendChild(atlas);
    await atlas.updateComplete;
    // jsdom does no layout and has no pointer capture.
    frame = atlas.querySelector<HTMLElement>("[data-atlas-frame]")!;
    Object.defineProperty(frame, "clientWidth", { value: 1000 });
    frame.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 652);
    frame.setPointerCapture = () => {};
    frame.hasPointerCapture = () => false;
    scrolled = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
  });

  afterEach(() => {
    atlas.remove();
    vi.unstubAllGlobals();
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  const pin = (id: string) =>
    atlas.querySelector<HTMLElement>(`[data-atlas-pin="${id}"]`);

  function pointer(type: string, clientX: number) {
    frame.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerId: 1,
        pointerType: "mouse",
        button: 0,
        clientX,
        clientY: 300,
      }),
    );
  }

  function wheel(deltaY: number): WheelEvent {
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY,
      clientX: 500,
      clientY: 300,
    });
    frame.dispatchEvent(event);
    return event;
  }

  it("pins every listed map that has a location", () => {
    const pinned = [...atlas.querySelectorAll("[data-atlas-pin]")]
      .map((p) => p.getAttribute("data-atlas-pin"))
      .sort();

    expect(pinned).toEqual(
      listedMaps
        .filter((m) => m.location !== undefined)
        .map((m) => m.id)
        .sort(),
    );
    expect(pin("World")).toBeNull();
  });

  it("selects the clicked pin's map and marks the selected pin", async () => {
    pin("Japan")!.click();
    expect(selected).toEqual([GameMapType.Japan]);

    atlas.selectedMap = GameMapType.Japan;
    await atlas.updateComplete;
    expect(pin("Japan")!.getAttribute("aria-pressed")).toBe("true");
    expect(pin("Korea")!.getAttribute("aria-pressed")).toBe("false");
  });

  it("does not select the pin a pan ends on", () => {
    pointer("pointerdown", 400);
    pointer("pointermove", 450);
    pointer("pointerup", 450);
    pin("Japan")!.click();

    expect(selected).toEqual([]);
  });

  // At a zoom limit, scrolling past it must keep scrolling the modal.
  it("only takes the wheel while it can zoom", async () => {
    expect(wheel(100).defaultPrevented).toBe(false);

    expect(wheel(-100).defaultPrevented).toBe(true);
    await atlas.updateComplete;
    expect(wheel(100).defaultPrevented).toBe(true);

    for (let i = 0; i < 10; i++) wheel(-100);
    await atlas.updateComplete;
    expect(wheel(-100).defaultPrevented).toBe(false);
  });

  // The frame clips its content, and on a phone it's shorter than the details.
  it("shows a pin's details outside the frame, on the side with room", async () => {
    const hover = async (id: string) => {
      pin(id)!.dispatchEvent(new PointerEvent("pointerenter"));
      await atlas.updateComplete;
      return atlas.querySelector<HTMLElement>('[role="tooltip"]')!;
    };

    const hawaii = await hover("Hawaii");
    expect(frame.contains(hawaii)).toBe(false);
    expect(hawaii.parentElement!.style.left).not.toBe("");

    const japan = await hover("Japan");
    expect(frame.contains(japan)).toBe(false);
    expect(japan.parentElement!.style.right).not.toBe("");
    expect(scrolled).toEqual([]);

    pin("Japan")!.click();
    await atlas.updateComplete;
    expect(scrolled).toContain(atlas.querySelector('[role="tooltip"]'));
  });

  it("pans a zoomed view and keeps it inside the world", async () => {
    wheel(-100);
    await atlas.updateComplete;
    const left = () => parseFloat(pin("Africa")!.style.left);
    const before = left();

    pointer("pointerdown", 400);
    pointer("pointermove", 300);
    await atlas.updateComplete;
    expect(left()).toBeLessThan(before);

    pointer("pointermove", -100_000);
    await atlas.updateComplete;
    expect(pin("Hawaii")).toBeNull();
    expect(pin("NewZealand")).not.toBeNull();
  });
});

describe("<map-details>", () => {
  let details: MapDetails | undefined;
  let languageFixture: HTMLElement | undefined;

  afterEach(() => {
    details?.remove();
    languageFixture?.remove();
  });

  async function render(map: MapInfo, stats?: MapStats) {
    const translations = {
      "map_component.by_author": en.map_component.by_author,
      "map_component.stat_land": en.map_component.stat_land,
      "map_component.stat_nations": en.map_component.stat_nations,
      "map_component.stat_players": en.map_component.stat_players,
      "map_description.test": "A narrow strait.",
    };
    languageFixture = document.createElement("lang-selector");
    Object.assign(languageFixture, {
      translations,
      defaultTranslations: translations,
      currentLang: "en",
    });
    document.body.appendChild(languageFixture);
    details = document.createElement("map-details") as MapDetails;
    details.map = map;
    details.stats = stats;
    document.body.appendChild(details);
    await details.updateComplete;
    return details;
  }

  const world = maps.find((m) => m.type === GameMapType.World)!;

  it("stays empty for a map without author or description", async () => {
    const bare = { ...world, author: undefined, descriptionKey: undefined };
    expect((await render(bare)).childElementCount).toBe(0);
  });

  it("shows the description and author", async () => {
    const el = await render({
      ...world,
      author: "Mapmaker",
      descriptionKey: "map_description.test",
    });
    const tooltip = el.querySelector('[role="tooltip"]');
    const text = tooltip?.textContent?.trim().replace(/\s+/g, " ");

    expect(el.querySelector("button")).toBeTruthy();
    expect(text).toBe("A narrow strait. Map designer: Mapmaker");
    expect(tooltip?.className).toContain("w-72");
    expect(tooltip?.className).toContain("-translate-x-1/2");
  });

  it("shows the stats between description and author", async () => {
    const el = await render(
      { ...world, author: "Mapmaker", descriptionKey: undefined },
      { width: 1748, height: 1420, landPercent: 35, nations: 1, players: 45 },
    );
    const text = el
      .querySelector('[role="tooltip"]')
      ?.textContent?.trim()
      .replace(/\s+/g, " ");

    expect(text).toBe(
      "1748×1420 1 nation 35% land ~45 players Map designer: Mapmaker",
    );
  });

  it("clamps tooltip within scroll container bounds on hover", async () => {
    const container = document.createElement("div");
    container.style.overflowY = "auto";
    container.style.position = "relative";
    container.style.width = "400px";
    container.style.height = "500px";
    document.body.appendChild(container);

    const el = await render({
      ...world,
      author: "Mapmaker",
      descriptionKey: "map_description.test",
    });
    container.appendChild(el);

    const group = el.querySelector<HTMLElement>(".group\\/map-details")!;
    const tooltip = el.querySelector<HTMLElement>('[role="tooltip"]')!;

    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      left: 0,
      right: 400,
      top: 0,
      bottom: 500,
      width: 400,
      height: 500,
      x: 0,
      y: 0,
      toJSON: () => {},
    });
    vi.spyOn(tooltip, "getBoundingClientRect").mockReturnValue({
      left: 150,
      right: 450,
      top: 50,
      bottom: 200,
      width: 300,
      height: 150,
      x: 150,
      y: 50,
      toJSON: () => {},
    });

    group.dispatchEvent(new PointerEvent("pointerenter"));
    expect(tooltip.style.transform).toBe("translateX(-58px)");

    // Focusing in while hovered keeps clamp
    group.dispatchEvent(new FocusEvent("focusin"));
    expect(tooltip.style.transform).toBe("translateX(-58px)");

    // Leaving pointer while still focused retains clamp
    group.dispatchEvent(new PointerEvent("pointerleave"));
    expect(tooltip.style.transform).toBe("translateX(-58px)");

    // Blurring when pointer has left clears clamp
    group.dispatchEvent(new FocusEvent("focusout"));
    expect(tooltip.style.transform).toBe("");

    // Focusing in again applies clamp
    group.dispatchEvent(new FocusEvent("focusin"));
    expect(tooltip.style.transform).toBe("translateX(-58px)");

    // Blurring clears clamp
    group.dispatchEvent(new FocusEvent("focusout"));
    expect(tooltip.style.transform).toBe("");

    container.remove();
  });

  it("preserves centered position when tooltip fits within bounds", async () => {
    const el = await render({
      ...world,
      author: "Mapmaker",
      descriptionKey: "map_description.test",
    });

    const group = el.querySelector<HTMLElement>(".group\\/map-details")!;
    const tooltip = el.querySelector<HTMLElement>('[role="tooltip"]')!;

    vi.spyOn(tooltip, "getBoundingClientRect").mockReturnValue({
      left: 100,
      right: 400,
      top: 50,
      bottom: 200,
      width: 300,
      height: 150,
      x: 100,
      y: 50,
      toJSON: () => {},
    });

    group.dispatchEvent(new PointerEvent("pointerenter"));
    expect(tooltip.style.transform).toBe("");
  });
});
