import { beforeEach, describe, expect, it } from "vitest";

import "../../src/client/UserSettingModal";
import type { UserSettingModal } from "../../src/client/UserSettingModal";
import type { MapLayer } from "../../src/core/game/TerrainMapLoader";
import {
  GRAPHICS_KEY,
  USER_SETTINGS_CHANGED_EVENT,
  UserSettings,
} from "../../src/core/game/UserSettings";

type TestModal = UserSettingModal & {
  updateComplete: Promise<unknown>;
  activeTab: string;
};

const LAYERS: MapLayer[] = [
  { id: "forest", placement: "land", nukeable: true, alpha: 0.8 },
  { id: "reef", placement: "water" },
];

/**
 * Open the Graphics tab with Advanced expanded, which is where every option
 * folded in from the old in-game graphics modal now lives.
 */
async function mountGraphics(
  wire?: Partial<
    Pick<
      UserSettingModal,
      "mapLayers" | "onLayerVisibilityChange" | "onLayerAlphaChange"
    >
  >,
): Promise<TestModal> {
  const el = document.createElement("user-setting") as TestModal;
  if (wire?.mapLayers) el.mapLayers = wire.mapLayers;
  if (wire?.onLayerVisibilityChange) {
    el.onLayerVisibilityChange = wire.onLayerVisibilityChange;
  }
  if (wire?.onLayerAlphaChange) {
    el.onLayerAlphaChange = wire.onLayerAlphaChange;
  }
  document.body.appendChild(el);
  el.open({ tab: "graphics" });
  await el.updateComplete;
  el.querySelector("#graphics-advanced-toggle")!.dispatchEvent(
    new Event("change", { bubbles: true }),
  );
  await el.updateComplete;
  // The advanced body is a child component with its own update cycle, and the
  // modal only hands it the map layers once it exists.
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  return el;
}

function control(el: TestModal, id: string): Element {
  const found = el.querySelector(`#${id}`);
  expect(found, `missing control #${id}`).not.toBeNull();
  return found!;
}

function slide(el: TestModal, id: string, value: number) {
  control(el, id).dispatchEvent(
    new CustomEvent("change", { detail: { value }, bubbles: true }),
  );
}

function pickColor(el: TestModal, id: string, value: string) {
  control(el, id).dispatchEvent(
    new CustomEvent("change", { detail: { value }, bubbles: true }),
  );
}

function flip(el: TestModal, id: string) {
  control(el, id).dispatchEvent(new Event("change", { bubbles: true }));
}

function overrides() {
  return new UserSettings().graphicsOverrides();
}

/**
 * UserSettings caches reads in a static map, so clearing localStorage alone
 * leaves the previous test's graphics state visible. Write both keys back to
 * empty through the public API instead. Storing "{}" for presets also marks
 * the legacy migration as done, so it cannot fire mid-test.
 */
function resetGraphicsSettings() {
  document.body.innerHTML = "";
  localStorage.clear();
  const settings = new UserSettings();
  settings.setGraphicsOverrides({});
  settings.setGraphicsPresets({});
}

describe("Graphics tab: advanced options folded in from the in-game modal", () => {
  beforeEach(resetGraphicsSettings);

  it("renders every folded control", async () => {
    const el = await mountGraphics();
    for (const id of [
      "ambient-light-slider",
      "unit-glow-slider",
      "name-scale-slider",
      "name-cull-slider",
      "hover-fade-slider",
      "hover-glow-width-slider",
      "hover-glow-alpha-slider",
      "colored-names-toggle",
      "icon-size-slider",
      "classic-icons-toggle",
      "classic-numbers-toggle",
      "structure-dots-toggle",
      "naval-highlight-toggle",
      "highlight-fill-slider",
      "highlight-brighten-slider",
      "highlight-thicken-slider",
      "territory-saturation-slider",
      "territory-alpha-slider",
      "alt-view-fill-alpha-slider",
      "coordinate-grid-opacity-slider",
      "rail-distance-slider",
      "rail-thickness-slider",
      "background-color-picker",
      "ocean-color-picker",
      "sand-color-picker",
      "plains-color-picker",
      "highland-color-picker",
      "mountain-color-picker",
      "nuke-color-picker",
      "special-effects-toggle",
      "fallout-toggle",
      "glow-strength-slider",
      "graphics-preset-name",
      "graphics-save-preset",
      "graphics-copy-json",
      "graphics-import-json",
      "graphics-import-apply",
      "graphics-reset",
    ]) {
      expect(
        el.querySelector(`#${id}`),
        `missing control #${id}`,
      ).not.toBeNull();
    }
  });

  it("writes each option into the same settings.graphics shape the old modal used", async () => {
    const el = await mountGraphics();

    // Lighting: both sliders are presented inverted/remapped, so the stored
    // value is not the slider value.
    slide(el, "ambient-light-slider", 10);
    expect(overrides().lighting?.ambient).toBeCloseTo(0.2);
    slide(el, "unit-glow-slider", 10);
    expect(overrides().lighting?.falloffPower).toBeCloseTo(1);

    slide(el, "name-scale-slider", 0.75);
    slide(el, "name-cull-slider", 0.012);
    slide(el, "hover-fade-slider", 0.4);
    slide(el, "hover-glow-width-slider", 2.5);
    slide(el, "hover-glow-alpha-slider", 0.3);
    expect(overrides().name).toMatchObject({
      nameScaleFactor: 0.75,
      cullThreshold: 0.012,
      hoverFadeAlpha: 0.4,
      hoverGlowWidth: 2.5,
      hoverGlowAlpha: 0.3,
    });

    slide(el, "icon-size-slider", 65);
    expect(overrides().structure?.iconSize).toBe(65);

    slide(el, "highlight-fill-slider", 0.42);
    slide(el, "highlight-brighten-slider", 0.21);
    slide(el, "highlight-thicken-slider", 3);
    slide(el, "territory-saturation-slider", 0.55);
    slide(el, "territory-alpha-slider", 0.66);
    slide(el, "coordinate-grid-opacity-slider", 0.11);
    expect(overrides().mapOverlay).toMatchObject({
      highlightFillBrighten: 0.42,
      highlightBrighten: 0.21,
      highlightThicken: 3,
      territorySaturation: 0.55,
      territoryAlpha: 0.66,
      coordinateGridOpacity: 0.11,
    });

    slide(el, "alt-view-fill-alpha-slider", 0.33);
    expect(overrides().altView?.fillAlpha).toBe(0.33);

    // Draw distance is stored inverted: further out = a lower railMinZoom.
    slide(el, "rail-distance-slider", 7);
    slide(el, "rail-thickness-slider", 2.5);
    expect(overrides().railroad).toMatchObject({
      railMinZoom: 3,
      railThickness: 2.5,
    });

    // Glow strength is shown as a percentage and stored 0-1.
    slide(el, "glow-strength-slider", 40);
    expect(overrides().smallPlayerGlow?.strength).toBeCloseTo(0.4);

    pickColor(el, "background-color-picker", "#112233");
    pickColor(el, "ocean-color-picker", "#223344");
    pickColor(el, "sand-color-picker", "#334455");
    pickColor(el, "plains-color-picker", "#445566");
    pickColor(el, "highland-color-picker", "#556677");
    pickColor(el, "mountain-color-picker", "#667788");
    expect(overrides().terrain).toMatchObject({
      backgroundColor: "#112233",
      oceanColor: "#223344",
      sandColor: "#334455",
      plainsColor: "#445566",
      highlandColor: "#556677",
      mountainColor: "#667788",
    });

    pickColor(el, "nuke-color-picker", "#AABBCC");
    expect(overrides().mapOverlay?.staleNukeColor).toBe("#aabbcc");
  });

  it("flips each folded toggle away from its default", async () => {
    const el = await mountGraphics();

    // Names are black by default, so the toggle turns player color on.
    flip(el, "colored-names-toggle");
    expect(overrides().name?.darkNames).toBe(false);

    flip(el, "classic-icons-toggle");
    flip(el, "classic-numbers-toggle");
    flip(el, "structure-dots-toggle");
    expect(overrides().structure).toMatchObject({
      classicIcons: false,
      classicNumbers: false,
      showDots: false,
    });

    // Off by default, unlike the others.
    flip(el, "naval-highlight-toggle");
    expect(overrides().mapOverlay?.navalHighlight).toBe(true);

    flip(el, "special-effects-toggle");
    flip(el, "fallout-toggle");
    expect(overrides().passEnabled).toMatchObject({
      fx: false,
      fallout: false,
    });
  });

  it("ignores a partial hex, as the old picker did while typing", async () => {
    const el = await mountGraphics();
    pickColor(el, "ocean-color-picker", "#12");
    expect(overrides().terrain?.oceanColor).toBeUndefined();
  });

  it("saves, copies and imports presets, and resets everything", async () => {
    const el = await mountGraphics();
    slide(el, "territory-alpha-slider", 0.5);

    const name = el.querySelector<HTMLInputElement>("#graphics-preset-name")!;
    name.value = "Mine";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>("#graphics-save-preset")!.click();
    expect(new UserSettings().graphicsPresets().Mine).toMatchObject({
      mapOverlay: { territoryAlpha: 0.5 },
    });

    const importBox = el.querySelector<HTMLTextAreaElement>(
      "#graphics-import-json",
    )!;
    importBox.value = '{"name":{"nameScaleFactor":1.1}}';
    importBox.dispatchEvent(new Event("input", { bubbles: true }));
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>("#graphics-import-apply")!.click();
    expect(overrides()).toEqual({ name: { nameScaleFactor: 1.1 } });

    el.querySelector<HTMLButtonElement>("#graphics-reset")!.click();
    expect(overrides()).toEqual({});
  });

  it("flags an unparseable import instead of applying it", async () => {
    const el = await mountGraphics();
    const importBox = el.querySelector<HTMLTextAreaElement>(
      "#graphics-import-json",
    )!;
    importBox.value = "not json";
    importBox.dispatchEvent(new Event("input", { bubbles: true }));
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>("#graphics-import-apply")!.click();
    await el.updateComplete;

    expect(el.querySelector("#graphics-import-error")).not.toBeNull();
    expect(overrides()).toEqual({});
  });
});

describe("Graphics tab: live apply from the in-game instance", () => {
  beforeEach(resetGraphicsSettings);

  it("fires the settings.graphics change event a running game listens for", async () => {
    // ClientGameRunner re-resolves the render settings and rebuilds the
    // GPU-derived state on this event. It is the whole of the live-apply path
    // for every option except the map layers below — the old modal reached the
    // renderer the same way.
    const el = await mountGraphics();
    const seen: string[] = [];
    const listener = () => seen.push("changed");
    globalThis.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${GRAPHICS_KEY}`,
      listener,
    );
    try {
      slide(el, "territory-alpha-slider", 0.25);
      flip(el, "fallout-toggle");
      pickColor(el, "ocean-color-picker", "#010203");
    } finally {
      globalThis.removeEventListener(
        `${USER_SETTINGS_CHANGED_EVENT}:${GRAPHICS_KEY}`,
        listener,
      );
    }
    expect(seen).toHaveLength(3);
  });

  it("applies a map-layer toggle to the renderer, and stores it", async () => {
    const visibility: [string, boolean][] = [];
    const el = await mountGraphics({
      mapLayers: LAYERS,
      onLayerVisibilityChange: (id, visible) => visibility.push([id, visible]),
    });

    flip(el, "map-layer-forest-toggle");

    expect(visibility).toEqual([["forest", false]]);
    expect(overrides().mapLayerVisibility).toEqual({ forest: false });
  });

  it("applies a map-layer opacity to the renderer, and stores it", async () => {
    const alphas: [string, number][] = [];
    const el = await mountGraphics({
      mapLayers: LAYERS,
      onLayerAlphaChange: (id, alpha) => alphas.push([id, alpha]),
    });

    slide(el, "map-layer-reef-alpha-slider", 0.4);

    expect(alphas).toEqual([["reef", 0.4]]);
    expect(overrides().mapLayerAlpha).toEqual({ reef: 0.4 });
  });

  it("re-pushes every layer to the renderer after a reset, as the old modal did", async () => {
    const visibility: [string, boolean][] = [];
    const alphas: [string, number][] = [];
    const el = await mountGraphics({
      mapLayers: LAYERS,
      onLayerVisibilityChange: (id, visible) => visibility.push([id, visible]),
      onLayerAlphaChange: (id, alpha) => alphas.push([id, alpha]),
    });

    flip(el, "map-layer-forest-toggle");
    visibility.length = 0;
    alphas.length = 0;

    el.querySelector<HTMLButtonElement>("#graphics-reset")!.click();

    // Back to visible, and back to the manifest default alpha.
    expect(visibility).toEqual([
      ["forest", true],
      ["reef", true],
    ]);
    expect(alphas).toEqual([
      ["forest", 0.8],
      ["reef", 1],
    ]);
  });
});

describe("Graphics tab: the page instance has no game", () => {
  beforeEach(resetGraphicsSettings);

  it("hides the map-layer section, because the rows come from the running map", async () => {
    const el = await mountGraphics();
    expect(el.querySelector("[data-map-layers]")).toBeNull();
    expect(el.querySelector("#map-layer-forest-toggle")).toBeNull();
    // Everything that is pure preference is still there.
    expect(el.querySelector("#territory-alpha-slider")).not.toBeNull();
  });

  it("shows the map-layer section once a game hands its layers over", async () => {
    const el = await mountGraphics({ mapLayers: LAYERS });
    expect(el.querySelector("[data-map-layers]")).not.toBeNull();
    expect(el.querySelector("#map-layer-forest-toggle")).not.toBeNull();
    expect(el.querySelector("#map-layer-reef-toggle")).not.toBeNull();
  });
});
