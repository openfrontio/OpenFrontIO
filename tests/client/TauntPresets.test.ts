import { describe, expect, it } from "vitest";
import {
  TAUNT_CSS,
  TAUNT_PRESETS,
  tauntPlayback,
} from "../../src/client/components/card/taunts/TauntPresets";

describe("TAUNT_PRESETS", () => {
  it("has the spec's ten presets", () => {
    expect(Object.keys(TAUNT_PRESETS).sort()).toEqual(
      [
        "badge_pulse",
        "crown_drop",
        "flag_plant",
        "mushroom_cloud",
        "nuke_flash",
        "salute",
        "shockwave",
        "territory_sweep",
        "tremor",
        "trophy",
      ].sort(),
    );
  });

  it("every icon preset ≤ 2000ms, every card preset ≤ 1500ms", () => {
    for (const [name, p] of Object.entries(TAUNT_PRESETS)) {
      const cap = p.kind === "icon" ? 2000 : 1500;
      expect(p.durationMs, name).toBeLessThanOrEqual(cap);
      expect(p.durationMs, name).toBeGreaterThan(0);
    }
  });

  it("keyframes animate only transform and opacity", () => {
    const keyframes = [
      ...TAUNT_CSS.matchAll(/@keyframes[^{]+\{([\s\S]*?)\n\}/g),
    ];
    expect(keyframes.length).toBeGreaterThanOrEqual(10);
    for (const [, body] of keyframes) {
      const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      for (const prop of props) {
        expect(["transform", "opacity"]).toContain(prop);
      }
    }
  });

  it("each preset's class names an animation in the CSS", () => {
    for (const p of Object.values(TAUNT_PRESETS)) {
      expect(TAUNT_CSS).toContain(`.${p.className}`);
    }
  });
});

describe("tauntPlayback", () => {
  const icon = TAUNT_PRESETS.salute;
  const card = TAUNT_PRESETS.nuke_flash;
  it.each([
    ["icon, normal", icon, false, false, "play"],
    ["icon, reduced motion", icon, true, false, "rest"],
    ["icon, muted", icon, false, true, "none"],
    ["card, normal", card, false, false, "play"],
    ["card, reduced motion", card, true, false, "none"],
    ["card, muted", card, false, true, "none"],
  ] as const)("%s", (_n, preset, reducedMotion, muted, expected) => {
    expect(tauntPlayback(preset, { reducedMotion, muted })).toBe(expected);
  });
});
