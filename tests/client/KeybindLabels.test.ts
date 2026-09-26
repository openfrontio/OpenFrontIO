import { afterEach, describe, expect, it, vi } from "vitest";

import { HelpModal } from "../../src/client/HelpModal";
import { resolveKeybindLabel } from "../../src/client/Utils";

describe("resolveKeybindLabel", () => {
  it("handles legacy array-valued keybinds without throwing", () => {
    expect(
      resolveKeybindLabel({ value: ["Digit1"], key: "1" }, "Digit2", null),
    ).toBe("1");
  });

  it("uses the first string from a legacy array when the layout map is available", () => {
    const layoutMap = new Map([["Digit1", "&"]]);

    expect(
      resolveKeybindLabel({ value: ["Digit1"], key: "1" }, "Digit2", layoutMap),
    ).toBe("&");
  });

  it("falls back to the default code for malformed saved values", () => {
    expect(
      resolveKeybindLabel({ value: [123], key: "1" }, "Digit2", null),
    ).toBe("2");
  });
});

describe("HelpModal keyboard layout refresh", () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    Navigator.prototype,
    "keyboard",
  );

  afterEach(() => {
    document.body.innerHTML = "";
    if (originalDescriptor) {
      Object.defineProperty(
        Navigator.prototype,
        "keyboard",
        originalDescriptor,
      );
    } else {
      delete (navigator as Navigator & { keyboard?: unknown }).keyboard;
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

    Object.defineProperty(navigator, "keyboard", {
      configurable: true,
      value: keyboard,
    });

    const modal = document.createElement("help-modal") as HelpModal & {
      updateComplete: Promise<unknown>;
    };
    const state = modal as unknown as {
      layoutMap: Map<string, string> | null;
    };
    document.body.appendChild(modal);

    await vi.waitFor(() => {
      expect(keyboard.getLayoutMap).toHaveBeenCalledTimes(1);
    });

    keyboard.dispatchEvent(new Event("layoutchange"));
    await vi.waitFor(() => {
      expect(keyboard.getLayoutMap).toHaveBeenCalledTimes(2);
    });

    resolveSecond(secondMap);
    await vi.waitFor(() => {
      expect(state.layoutMap).toBe(secondMap);
    });

    resolveFirst(firstMap);
    await Promise.resolve();
    expect(state.layoutMap).toBe(secondMap);

    modal.remove();
    keyboard.dispatchEvent(new Event("layoutchange"));
    await Promise.resolve();

    expect(keyboard.getLayoutMap).toHaveBeenCalledTimes(2);
  });
});
