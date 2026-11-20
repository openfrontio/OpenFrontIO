import { describe, expect, test } from "vitest";
import {
  CARD_ART_HEIGHT,
  CARD_ART_WIDTH,
  checkCardBackground,
  parseCardAnimation,
} from "../src/client/cosmetic-preview/checks";

// The package's DOM-free entry (@openfront/cosmetic-preview/checks): what a
// host's server uses to re-check a submission against the game's schema.
describe("cosmetic-preview checks entry", () => {
  test("parses a layer animation with the game's schema", () => {
    const parsed = parseCardAnimation({
      kind: "layers",
      layers: [{ src: "bg_x_fx-pulse.png", effect: "pulse", period: 2 }],
    });
    expect(parsed).toEqual({
      ok: true,
      animation: {
        kind: "layers",
        layers: [{ src: "bg_x_fx-pulse.png", effect: "pulse", period: 2 }],
      },
    });
  });

  test("refuses what the game would refuse, with the reason", () => {
    const parsed = parseCardAnimation({
      kind: "layers",
      layers: [{ src: "a.png", effect: "pulse", min: 0.9, max: 0.2 }],
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("min");
    expect(parseCardAnimation({ kind: "mask", mask: "m.png" }).ok).toBe(false);
    expect(parseCardAnimation({ kind: "layers", layers: [] }).ok).toBe(false);
  });

  test("re-exports the checks and the art size", () => {
    expect([CARD_ART_WIDTH, CARD_ART_HEIGHT]).toEqual([2800, 400]);
    expect(typeof checkCardBackground).toBe("function");
  });

  test("never touches the DOM", async () => {
    // Runs in the node environment: importing it must not need a document.
    expect(typeof document).toBe("undefined");
  });
});
