import { afterEach, describe, expect, it } from "vitest";
import "../../src/client/components/EffectPreview";
import type {
  EffectScene,
  SceneEffect,
} from "../../src/client/components/EffectPreview";
import type { Effect } from "../../src/core/CosmeticSchemas";

const base = { name: "fx", product: null, rarity: "rare" } as const;

const gradient = {
  type: "gradient",
  colors: ["#ff0000", "#00ff00", "#0000ff"],
  colorSize: 2,
  movementSpeed: 3,
} as const;

const transition = {
  type: "transition",
  colors: ["#ff0000", "#ffffff"],
  frequency: 2,
} as const;

function effect<T extends SceneEffect["effectType"]>(
  effectType: T,
  attributes: Extract<Effect, { effectType: T }>["attributes"],
): SceneEffect {
  return { ...base, effectType, attributes } as SceneEffect;
}

describe("EffectScene", () => {
  let scene: EffectScene | undefined;

  afterEach(() => {
    scene?.remove();
    scene = undefined;
  });

  async function render(fx: SceneEffect): Promise<EffectScene> {
    scene = document.createElement("effect-scene") as EffectScene;
    scene.effect = fx;
    document.body.appendChild(scene);
    await scene.updateComplete;
    return scene;
  }

  it("draws the transport ship trail as stamped tiles behind the ship", async () => {
    const el = await render(effect("transportShipTrail", gradient));
    expect(
      el.querySelector("[data-effect-scene='transportShipTrail']"),
    ).toBeTruthy();
    const trail = el.querySelector("[data-trail]")!;
    // World-space gradient: the trail is filled by a repeating gradient along
    // the map diagonal, one cycle = colorSize · count tiles of x + y.
    expect(trail.getAttribute("fill")).toMatch(/^url\(#/);
    const grad = el.querySelector("linearGradient")!;
    expect(grad.getAttribute("spreadMethod")).toBe("repeat");
    expect(grad.getAttribute("gradientUnits")).toBe("userSpaceOnUse");
    expect(grad.getAttribute("x2")).toBe("3");
    expect(grad.getAttribute("y2")).toBe("3");
    expect(
      [...grad.querySelectorAll("stop")].map((s) =>
        s.getAttribute("stop-color"),
      ),
    ).toEqual(["#ff0000", "#00ff00", "#0000ff", "#ff0000"]);
    // Scrolls one cycle every colorSize · count / movementSpeed seconds.
    const scroll = grad.querySelector("animateTransform")!;
    expect(scroll.getAttribute("dur")).toBe("2s");
    expect(scroll.getAttribute("to")).toBe("3 3");
    // The ship itself keeps the player's colors (three paths: trail + 2 bands).
    expect(el.querySelectorAll("path").length).toBe(3);
  });

  it("holds a gradient still when movementSpeed is 0 and reverses when negative", async () => {
    let el = await render(
      effect("transportShipTrail", { ...gradient, movementSpeed: 0 }),
    );
    expect(el.querySelector("animateTransform")).toBeNull();
    el.remove();
    el = await render(
      effect("transportShipTrail", { ...gradient, movementSpeed: -3 }),
    );
    expect(el.querySelector("animateTransform")?.getAttribute("to")).toBe(
      "-3 -3",
    );
  });

  it("cross-fades a transition through the palette at 1/frequency per step", async () => {
    const el = await render(effect("railroad", transition));
    const rails = el.querySelector("[data-rails]")!;
    expect(rails.getAttribute("fill")).toBe("#ff0000");
    const fade = rails.querySelector("animate")!;
    expect(fade.getAttribute("attributeName")).toBe("fill");
    expect(fade.getAttribute("values")).toBe("#ff0000;#ffffff;#ff0000");
    expect(fade.getAttribute("dur")).toBe("1s");
  });

  it("paints a single color flat and drops colors the renderer can't parse", async () => {
    const el = await render(
      effect("warship", { ...gradient, colors: ["nope", "#123456"] }),
    );
    expect(el.querySelector("linearGradient")).toBeNull();
    expect(el.querySelector("path[fill='#123456']")).toBeTruthy();
  });

  it("falls back to the player's colors when the palette is empty", async () => {
    const el = await render(effect("structures", { ...gradient, colors: [] }));
    expect(el.querySelector("linearGradient")).toBeNull();
    expect(el.querySelector("[data-fill]")?.getAttribute("fill")).toMatch(/^#/);
  });

  it("spans a structure's gradient across the city icon once", async () => {
    const el = await render(effect("structures", gradient));
    expect(el.querySelector("[data-glyph]")).toBeTruthy();
    expect(el.querySelector("[data-fill]")?.getAttribute("fill")).toMatch(
      /^url\(#/,
    );
    const grad = el.querySelector("linearGradient")!;
    // Icon space: one palette cycle is the icon diagonal, anchored to center.
    expect(grad.getAttribute("x1")).toBe("-0.5");
    expect(grad.getAttribute("x2")).toBe("0.5");
    expect(grad.querySelector("animateTransform")?.getAttribute("to")).toBe(
      "1 1",
    );
  });

  it("recolors the warship's light band only", async () => {
    const el = await render(effect("warship", gradient));
    const paths = [...el.querySelectorAll("path")];
    expect(
      paths.filter((p) => p.getAttribute("fill")?.startsWith("url(#")),
    ).toHaveLength(1);
    expect(el.querySelector("linearGradient")?.getAttribute("x2")).toBe("13");
  });

  it("recolors both train bands, the dark band darkened", async () => {
    const el = await render(effect("train", gradient));
    const grads = [...el.querySelectorAll("linearGradient")];
    expect(grads).toHaveLength(2);
    const darkStops = [...grads[1].querySelectorAll("stop")].map((s) =>
      s.getAttribute("stop-color"),
    );
    expect(darkStops[0]).toBe("#990000");
    // Engine (1 band) + 3 carriages (2 bands each) + rails.
    expect(el.querySelectorAll("path")).toHaveLength(8);
    expect(el.querySelector("[data-rails]")?.getAttribute("fill")).toBe(
      "#ffffff",
    );
  });

  it("winds nuke spiral strands into the missile over a flat spine", async () => {
    const el = await render(
      effect("nukeTrail", {
        type: "spiral",
        colors: ["#ff00ff", "#00ffff"],
        radius: 4,
        strands: 3,
        rotationSpeed: Math.PI,
      }),
    );
    expect(el.querySelector("[data-trail]")?.getAttribute("fill")).toBe(
      "#ff00ff",
    );
    const strands = [...el.querySelectorAll("[data-strand]")];
    expect(strands).toHaveLength(3);
    // Each strand dims once per revolution (2π / rotationSpeed s), phase-offset.
    const spins = strands.map((s) => s.querySelector("animate")!);
    expect(spins[0].getAttribute("dur")).toBe("2s");
    expect(spins[1].getAttribute("begin")).toBe(`${-2 / 3}s`);
    expect(strands[1].querySelector("path")?.getAttribute("stroke")).toBe(
      "#00ffff",
    );
    // The nuke flickers through the hot colors.
    const flicker = el.querySelector("animate[calcMode='discrete']")!;
    expect(flicker.getAttribute("values")).toContain("#ffffff");
  });

  it("draws a spiral ship trail as a flat line in the first color", async () => {
    const el = await render(
      effect("transportShipTrail", {
        type: "spiral",
        colors: ["#ff00ff", "#00ffff"],
        radius: 4,
        strands: 3,
        rotationSpeed: 1,
      }),
    );
    expect(el.querySelector("[data-strand]")).toBeNull();
    expect(el.querySelector("[data-trail]")?.getAttribute("fill")).toBe(
      "#ff00ff",
    );
  });

  it("gives each scene its own gradient ids", async () => {
    const a = await render(effect("railroad", gradient));
    const b = document.createElement("effect-scene") as EffectScene;
    b.effect = effect("railroad", gradient);
    document.body.appendChild(b);
    await b.updateComplete;
    try {
      expect(a.querySelector("linearGradient")?.id).not.toBe(
        b.querySelector("linearGradient")?.id,
      );
    } finally {
      b.remove();
    }
  });
});
