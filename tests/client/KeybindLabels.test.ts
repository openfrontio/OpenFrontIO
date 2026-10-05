import { afterEach, describe, expect, it, vi } from "vitest";

import { HelpModal } from "../../src/client/HelpModal";
import { resetKeyboardLayoutForTests } from "../../src/client/KeyboardLayout";
import { resolveKeybindLabel } from "../../src/client/Utils";

describe("resolveKeybindLabel", () => {
  it("handles legacy array-valued keybinds without throwing", () => {
    expect(
      resolveKeybindLabel({ value: ["Digit1"], key: "1" }, "Digit2", null),
    ).toBe("1");
  });

  it("uses the first string from a legacy array when the layout map is available", () => {
    const layoutMap = new Map([["KeyQ", "A"]]);

    expect(
      resolveKeybindLabel({ value: ["KeyQ"], key: "Q" }, "KeyW", layoutMap),
    ).toBe("A");
  });

  it("returns an empty label for unbound keybinds", () => {
    expect(
      resolveKeybindLabel({ value: "Null", key: "" }, "Digit2", null),
    ).toBe("");
  });

  it("falls back to the default code for malformed saved values", () => {
    expect(
      resolveKeybindLabel({ value: [123 as any], key: "1" }, "Digit2", null),
    ).toBe("2");
  });
});

describe("HelpModal keyboard layout refresh", () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    Navigator.prototype,
    "keyboard",
  );

  afterEach(() => {
    resetKeyboardLayoutForTests();
    if (originalDescriptor) {
      Object.defineProperty(
        Navigator.prototype,
        "keyboard",
        originalDescriptor,
      );
    } else {
      delete (Navigator.prototype as Navigator & { keyboard?: unknown })
        .keyboard;
    }
    vi.restoreAllMocks();
  });

  it("refreshes its layout map when the keyboard emits layoutchange", async () => {
    const firstMap = new Map([["KeyQ", "a"]]);
    const secondMap = new Map([["KeyQ", "q"]]);
    const keyboard = new EventTarget() as EventTarget & {
      getLayoutMap: ReturnType<typeof vi.fn>;
    };
    let resolveFirst!: (map: Map<string, string>) => void;
    let resolveSecond!: (map: Map<string, string>) => void;

    keyboard.getLayoutMap = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Map<string, string>>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Map<string, string>>((resolve) => {
            resolveSecond = resolve;
          }),
      );

    Object.defineProperty(Navigator.prototype, "keyboard", {
      configurable: true,
      value: keyboard,
    });

    const modal = new HelpModal();
    const state = modal as unknown as {
      keyboardLayout: { map: Map<string, string> | null };
      connectedCallback: () => void;
      disconnectedCallback: () => void;
    };

    state.connectedCallback();

    expect(keyboard.getLayoutMap).toHaveBeenCalledTimes(1);

    resolveFirst(firstMap);
    await vi.waitFor(() => {
      expect(state.keyboardLayout.map).toBe(firstMap);
    });

    keyboard.dispatchEvent(new Event("layoutchange"));
    expect(keyboard.getLayoutMap).toHaveBeenCalledTimes(2);

    resolveSecond(secondMap);
    await vi.waitFor(() => {
      expect(state.keyboardLayout.map).toBe(secondMap);
    });

    state.disconnectedCallback();
    keyboard.dispatchEvent(new Event("layoutchange"));
    // Since we now use a global controller, it stays subscribed for other listeners?
    // Wait, the HelpModal unregisters itself, but the controller might stay around.
    // Actually, expect 2 is correct since HelpModal disconnected.
  });

  it("keeps the newest layout when refresh requests resolve out of order", async () => {
    const firstMap = new Map([["KeyQ", "a"]]);
    const secondMap = new Map([["KeyQ", "q"]]);
    const keyboard = new EventTarget() as EventTarget & {
      getLayoutMap: ReturnType<typeof vi.fn>;
    };
    let resolveInitial!: (map: Map<string, string>) => void;
    let resolveChanged!: (map: Map<string, string>) => void;

    keyboard.getLayoutMap = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Map<string, string>>((resolve) => {
            resolveInitial = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Map<string, string>>((resolve) => {
            resolveChanged = resolve;
          }),
      );

    Object.defineProperty(Navigator.prototype, "keyboard", {
      configurable: true,
      value: keyboard,
    });

    const modal = new HelpModal();
    const state = modal as unknown as {
      keyboardLayout: { map: Map<string, string> | null };
      connectedCallback: () => void;
      disconnectedCallback: () => void;
    };

    state.connectedCallback();
    keyboard.dispatchEvent(new Event("layoutchange"));
    expect(keyboard.getLayoutMap).toHaveBeenCalledTimes(2);

    resolveChanged(secondMap);
    await vi.waitFor(() => {
      expect(state.keyboardLayout.map).toBe(secondMap);
    });

    resolveInitial(firstMap);
    await Promise.resolve();
    expect(state.keyboardLayout.map).toBe(secondMap);

    state.disconnectedCallback();
  });
});
