import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HelpModal } from "../../src/client/HelpModal";
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

function makeModal(): HelpModal {
  const modal = new HelpModal();
  // Bypass connectedCallback / DOM upgrade — we only exercise getKeyLabel.
  return modal;
}

describe("HelpModal.getKeyLabel", () => {
  beforeEach(() => {
    _resetForTesting();
  });

  afterEach(() => {
    _resetForTesting();
    removeLayout();
  });

  describe("special labels (UI-specific)", () => {
    it("returns the styled Shift label for ShiftLeft / ShiftRight", () => {
      const m = makeModal();
      expect(
        (m as unknown as { getKeyLabel(c: string): string }).getKeyLabel(
          "ShiftLeft",
        ),
      ).toBe("⇧ Shift");
      expect(
        (m as unknown as { getKeyLabel(c: string): string }).getKeyLabel(
          "ShiftRight",
        ),
      ).toBe("⇧ Shift");
    });

    it("returns arrows for arrow codes", () => {
      const m = makeModal();
      const get = (code: string) =>
        (m as unknown as { getKeyLabel(c: string): string }).getKeyLabel(code);
      expect(get("ArrowUp")).toBe("↑");
      expect(get("ArrowDown")).toBe("↓");
      expect(get("ArrowLeft")).toBe("←");
      expect(get("ArrowRight")).toBe("→");
    });

    it("returns Esc / Enter / Space symbols", () => {
      const m = makeModal();
      const get = (code: string) =>
        (m as unknown as { getKeyLabel(c: string): string }).getKeyLabel(code);
      expect(get("Escape")).toBe("Esc");
      expect(get("Enter")).toBe("↵ Return");
      expect(get("Space")).toBe("Space");
    });
  });

  describe("fallback path (no layout map)", () => {
    it("strips the Key prefix for letter codes", () => {
      const m = makeModal();
      const get = (code: string) =>
        (m as unknown as { getKeyLabel(c: string): string }).getKeyLabel(code);
      expect(get("KeyA")).toBe("A");
      expect(get("KeyZ")).toBe("Z");
    });

    it("strips the Digit prefix for digit codes", () => {
      const m = makeModal();
      const get = (code: string) =>
        (m as unknown as { getKeyLabel(c: string): string }).getKeyLabel(code);
      expect(get("Digit1")).toBe("1");
      expect(get("Digit0")).toBe("0");
    });

    it("formats Numpad keys with a Num prefix", () => {
      const m = makeModal();
      expect(
        (m as unknown as { getKeyLabel(c: string): string }).getKeyLabel(
          "Numpad7",
        ),
      ).toBe("Num 7");
    });

    it("returns the empty string for empty input", () => {
      const m = makeModal();
      expect(
        (m as unknown as { getKeyLabel(c: string): string }).getKeyLabel(""),
      ).toBe("");
    });
  });

  describe("layout-aware path", () => {
    it("returns the layout-mapped character when available", async () => {
      installLayout({ KeyW: "z", KeyA: "q", Digit1: "&" });
      await loadKeyboardLayout();

      const m = makeModal();
      const get = (code: string) =>
        (m as unknown as { getKeyLabel(c: string): string }).getKeyLabel(code);
      // AZERTY positions: physical W key prints "Z", physical A key prints "Q".
      expect(get("KeyW")).toBe("Z");
      expect(get("KeyA")).toBe("Q");
      expect(get("Digit1")).toBe("&");
    });

    it("never overrides the special-label table even if the layout map has the code", async () => {
      installLayout({ Space: "ignored", Escape: "ignored" });
      await loadKeyboardLayout();

      const m = makeModal();
      const get = (code: string) =>
        (m as unknown as { getKeyLabel(c: string): string }).getKeyLabel(code);
      expect(get("Space")).toBe("Space");
      expect(get("Escape")).toBe("Esc");
    });
  });
});
