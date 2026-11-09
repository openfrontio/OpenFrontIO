import { flattenedEmojiTable } from "@openfront/engine-api/Schemas";
import { describe, expect, it } from "vitest";
import {
  FAVORITE_SLOTS,
  emojiSections,
  favoriteKeyLabel,
  favoriteSlotForKey,
  placeFavorite,
} from "../../src/client/EmojiKeys";

const key = (code: string, mods: Partial<KeyboardEvent> = {}) => ({
  code,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
});

describe("EmojiKeys", () => {
  it("lays out every emoji exactly once", () => {
    const shown = emojiSections.flatMap((s) => s.emojis);
    expect([...shown].sort()).toEqual([...flattenedEmojiTable].sort());
  });

  it("has a slot for each of Q W E A S D", () => {
    expect(FAVORITE_SLOTS).toBe(6);
    const labels = Array.from({ length: FAVORITE_SLOTS }, (_, i) =>
      favoriteKeyLabel(i),
    );
    expect(labels.join("")).toBe("qweasd");
    labels.forEach((label, slot) =>
      expect(favoriteSlotForKey(key(`Key${label.toUpperCase()}`))).toBe(slot),
    );
  });

  it("ignores other letters, digits, and modified or unrelated keys", () => {
    expect(favoriteSlotForKey(key("KeyF"))).toBeNull();
    expect(favoriteSlotForKey(key("Digit1"))).toBeNull();
    expect(favoriteSlotForKey(key("KeyQ", { shiftKey: true }))).toBeNull();
    expect(favoriteSlotForKey(key("KeyQ", { ctrlKey: true }))).toBeNull();
    expect(favoriteSlotForKey(key("KeyQ", { metaKey: true }))).toBeNull();
    expect(favoriteSlotForKey(key("KeyQ", { altKey: true }))).toBeNull();
    expect(favoriteSlotForKey(key("Space"))).toBeNull();
    expect(favoriteSlotForKey(key("Escape"))).toBeNull();
  });

  describe("placeFavorite", () => {
    it("fills or replaces a slot", () => {
      expect(placeFavorite([null, null], "👍", 1)).toEqual([null, "👍"]);
      expect(placeFavorite(["💀", null], "👍", 0)).toEqual(["👍", null]);
    });

    it("moves an existing favorite, swapping with the target", () => {
      expect(placeFavorite(["👍", "💀", null], "👍", 1)).toEqual([
        "💀",
        "👍",
        null,
      ]);
      expect(placeFavorite(["👍", null], "👍", 1)).toEqual([null, "👍"]);
    });
  });
});
