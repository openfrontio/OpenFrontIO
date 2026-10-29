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
import type { EarthMap } from "../../src/client/components/map/EarthMap";
import "../../src/client/components/map/EarthMap";
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

describe("<earth-map>", () => {
  let earth: EarthMap;
  let frame: HTMLElement;
  let selected: GameMapType[];

  beforeEach(async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response('<svg><path id="land" d="M0 0l10 0 0 10z"/></svg>'),
      ),
    );
    selected = [];
    earth = document.createElement("earth-map") as EarthMap;
    earth.onSelectMap = (map) => selected.push(map);
    document.body.appendChild(earth);
    await earth.updateComplete;
    // jsdom does no layout and has no pointer capture.
    frame = earth.querySelector<HTMLElement>("[data-earth-frame]")!;
    Object.defineProperty(frame, "clientWidth", { value: 1000 });
    frame.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 652);
    frame.setPointerCapture = () => {};
    frame.hasPointerCapture = () => false;
  });

  afterEach(() => {
    earth.remove();
    vi.unstubAllGlobals();
  });

  const pin = (id: string) =>
    earth.querySelector<HTMLElement>(`[data-earth-pin="${id}"]`);

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
    const pinned = [...earth.querySelectorAll("[data-earth-pin]")]
      .map((p) => p.getAttribute("data-earth-pin"))
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

    earth.selectedMap = GameMapType.Japan;
    await earth.updateComplete;
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

  // Fully zoomed out, scrolling down must keep scrolling the modal.
  it("only takes the wheel while it can zoom", async () => {
    expect(wheel(100).defaultPrevented).toBe(false);

    expect(wheel(-100).defaultPrevented).toBe(true);
    await earth.updateComplete;
    expect(wheel(100).defaultPrevented).toBe(true);
  });

  it("pans a zoomed view and keeps it inside the world", async () => {
    wheel(-100);
    await earth.updateComplete;
    const left = () => parseFloat(pin("Africa")!.style.left);
    const before = left();

    pointer("pointerdown", 400);
    pointer("pointermove", 300);
    await earth.updateComplete;
    expect(left()).toBeLessThan(before);

    pointer("pointermove", -100_000);
    await earth.updateComplete;
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
    const text = el
      .querySelector('[role="tooltip"]')
      ?.textContent?.trim()
      .replace(/\s+/g, " ");

    expect(el.querySelector("button")).toBeTruthy();
    expect(text).toBe("A narrow strait. Map maker: Mapmaker");
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
      "1748×1420 1 nation 35% land ~45 players Map maker: Mapmaker",
    );
  });
});
