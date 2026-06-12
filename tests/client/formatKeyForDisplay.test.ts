import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatKeyForDisplay } from "../../src/client/Utils";
import {
  _resetForTesting,
  loadKeyboardLayout,
} from "../../src/client/utilities/KeyboardLayout";

interface FakeKeyboard {
  getLayoutMap(): Promise<Map<string, string>>;
  addEventListener(): void;
  removeEventListener(): void;
}

function installLayout(layout: Record<string, string>): void {
  const fake: FakeKeyboard = {
    getLayoutMap: () => Promise.resolve(new Map(Object.entries(layout))),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  Object.defineProperty(navigator, "keyboard", {
    configurable: true,
    value: fake,
  });
}

function removeLayout(): void {
  Object.defineProperty(navigator, "keyboard", {
    configurable: true,
    value: undefined,
  });
  delete (navigator as Partial<{ keyboard: unknown }>).keyboard;
}

describe("formatKeyForDisplay", () => {
  beforeEach(() => {
    _resetForTesting();
  });

  afterEach(() => {
    _resetForTesting();
    removeLayout();
  });

  describe("fallback (no layout map)", () => {
    it("returns empty string for empty input", () => {
      expect(formatKeyForDisplay("")).toBe("");
    });

    it("normalizes Space variants", () => {
      expect(formatKeyForDisplay("Space")).toBe("Space");
      expect(formatKeyForDisplay(" ")).toBe("Space");
    });

    it("strips the Key prefix from letter codes", () => {
      expect(formatKeyForDisplay("KeyA")).toBe("A");
      expect(formatKeyForDisplay("KeyZ")).toBe("Z");
    });

    it("strips the Digit prefix from digit codes", () => {
      expect(formatKeyForDisplay("Digit1")).toBe("1");
      expect(formatKeyForDisplay("Digit0")).toBe("0");
    });

    it("preserves Shift+ prefix and recurses into the suffix", () => {
      expect(formatKeyForDisplay("Shift+KeyR")).toBe("Shift+R");
      expect(formatKeyForDisplay("Shift+Digit5")).toBe("Shift+5");
    });

    it("capitalizes the first letter for unrecognized codes", () => {
      expect(formatKeyForDisplay("ArrowUp")).toBe("ArrowUp");
      expect(formatKeyForDisplay("escape")).toBe("Escape");
      expect(formatKeyForDisplay("period")).toBe("Period");
    });
  });

  describe("with the Keyboard Layout Map API available", () => {
    it("returns the layout-mapped character for letter codes", async () => {
      installLayout({
        KeyW: "z",
        KeyA: "q",
        KeyS: "s",
        KeyD: "d",
      });
      await loadKeyboardLayout();

      // AZERTY: physical W-position prints "Z", physical A-position prints "Q".
      expect(formatKeyForDisplay("KeyW")).toBe("Z");
      expect(formatKeyForDisplay("KeyA")).toBe("Q");
      expect(formatKeyForDisplay("KeyS")).toBe("S");
      expect(formatKeyForDisplay("KeyD")).toBe("D");
    });

    it("returns the layout-mapped character for digit codes", async () => {
      // AZERTY top row: digits require shift; unshifted is a symbol.
      installLayout({ Digit1: "&", Digit2: "é" });
      await loadKeyboardLayout();

      expect(formatKeyForDisplay("Digit1")).toBe("&");
      expect(formatKeyForDisplay("Digit2")).toBe("É");
    });

    it("composes Shift+ prefix with the layout-mapped suffix", async () => {
      installLayout({ KeyR: "r" });
      await loadKeyboardLayout();

      expect(formatKeyForDisplay("Shift+KeyR")).toBe("Shift+R");
    });

    it("falls back to QWERTY when the layout map has no entry for the code", async () => {
      installLayout({ KeyW: "z" });
      await loadKeyboardLayout();

      // Not in the map → QWERTY fallback path runs.
      expect(formatKeyForDisplay("KeyA")).toBe("A");
      expect(formatKeyForDisplay("Digit1")).toBe("1");
    });

    it("does not consult the layout map for the special Space code", async () => {
      installLayout({ Space: "ignored" });
      await loadKeyboardLayout();

      expect(formatKeyForDisplay("Space")).toBe("Space");
    });
  });
});
