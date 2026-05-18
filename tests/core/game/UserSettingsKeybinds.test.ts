import { describe, expect, test } from "vitest";
import { getDefaultKeybinds } from "../../../src/core/game/UserSettings";

describe("getDefaultKeybinds", () => {
  test("resetGfx defaults to Alt+KeyR", () => {
    expect(getDefaultKeybinds(false).resetGfx).toBe("Alt+KeyR");
    expect(getDefaultKeybinds(true).resetGfx).toBe("Alt+KeyR");
  });

  test("selectAllWarships defaults to KeyF", () => {
    expect(getDefaultKeybinds(false).selectAllWarships).toBe("KeyF");
  });

  test("shiftKey (warship box select) defaults to ShiftLeft", () => {
    expect(getDefaultKeybinds(false).shiftKey).toBe("ShiftLeft");
  });

  test("modifierKey is platform aware", () => {
    expect(getDefaultKeybinds(false).modifierKey).toBe("ControlLeft");
    expect(getDefaultKeybinds(true).modifierKey).toBe("MetaLeft");
  });
});
