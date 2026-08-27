import { describe, expect, it } from "vitest";
import { WebGLFrameBuilder } from "../src/client/WebGLFrameBuilder";
import {
  MAX_TRAIL_COLORS,
  STRUCTURES_EFFECT_BLOCK,
} from "../src/client/render/gl/utils/ColorUtils";

const PALETTE_SIZE = 4096;
const LOCAL = 5;

// Exercises syncPlayerEffects with no cosmetics catalog cached (as in dev,
// where there is no API) — the effect-editor override path.
function setup() {
  const uploads: Float32Array[] = [];
  const view = {
    updateEffectPalette: (p: Float32Array) => uploads.push(p),
  };
  const builder = new WebGLFrameBuilder(view as never) as unknown as {
    localPlayerSmallID: number;
    effectResolved: Set<number>;
    setEffectOverride: WebGLFrameBuilder["setEffectOverride"];
    syncPlayerEffects(gameView: unknown): void;
  };
  builder.localPlayerSmallID = LOCAL;
  const gameView = {
    players: () => [{ smallID: () => LOCAL, cosmetics: { effects: {} } }],
    setNukeTrailSpiral: () => {},
    clearNukeTrailSpiral: () => {},
  };
  const countOf = (p: Float32Array) =>
    p[
      (STRUCTURES_EFFECT_BLOCK * MAX_TRAIL_COLORS * PALETTE_SIZE + LOCAL) * 4 +
        3
    ];
  return { builder, gameView, uploads, countOf };
}

describe("WebGLFrameBuilder effect overrides", () => {
  it("re-uploads the palette when the last override is removed", () => {
    const { builder, gameView, uploads, countOf } = setup();
    builder.setEffectOverride("structures", {
      type: "gradient",
      colors: ["#ff0000", "#00ff00"],
      colorSize: 4,
      movementSpeed: 10,
    });
    builder.syncPlayerEffects(gameView);
    expect(uploads).toHaveLength(1);
    expect(countOf(uploads[0])).toBe(2);

    // Nothing changed → no redundant upload.
    builder.syncPlayerEffects(gameView);
    expect(uploads).toHaveLength(1);

    // Disabling the only override must clear the GPU entry too.
    builder.setEffectOverride("structures", null);
    builder.syncPlayerEffects(gameView);
    expect(uploads).toHaveLength(2);
    expect(countOf(uploads[1])).toBe(0);
  });

  it("keeps an override-only player unresolved until the catalog loads", () => {
    const { builder, gameView } = setup();
    builder.setEffectOverride("warship", {
      type: "transition",
      colors: ["#ffffff"],
      frequency: 1,
    });
    builder.syncPlayerEffects(gameView);
    expect(builder.effectResolved.has(LOCAL)).toBe(false);
  });
});
