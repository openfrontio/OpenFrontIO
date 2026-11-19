import { afterEach, describe, expect, it } from "vitest";
import type { LoadoutItem } from "../../src/client/hud/layers/LoadoutRow";
import {
  clearSavedLooks,
  isLookSaved,
  MAX_SAVED_LOOKS,
  savedLooks,
  saveLook,
  unsaveLook,
} from "../../src/client/hud/layers/SavedLooks";

// Looks the viewer saves from the player panel ("Get the look"), kept in
// memory for the current game only, for the end screen.

const ITEM: LoadoutItem = {
  type: "cardBackground",
  item: { name: "bg_pacific", rarity: "epic", product: null } as never,
  state: "buy",
  priceHard: 400,
};
const look = (clientID: string, items: LoadoutItem[] = [ITEM]) => ({
  clientID,
  name: `name-${clientID}`,
  items,
});
const names = (gameID: string) => savedLooks(gameID).map((l) => l.clientID);

describe("saved looks", () => {
  afterEach(() => clearSavedLooks());

  it("save and unsave", () => {
    saveLook("g1", look("a"));
    expect(isLookSaved("g1", "a")).toBe(true);
    expect(savedLooks("g1")[0]).toEqual(look("a"));
    unsaveLook("g1", "a");
    expect(isLookSaved("g1", "a")).toBe(false);
    expect(savedLooks("g1")).toEqual([]);
  });

  it("newest first, at most three", () => {
    expect(MAX_SAVED_LOOKS).toBe(3);
    for (const id of ["a", "b", "c", "d"]) saveLook("g1", look(id));
    expect(names("g1")).toEqual(["d", "c", "b"]);
  });

  it("saving a player again moves them to the front, once", () => {
    saveLook("g1", look("a"));
    saveLook("g1", look("b"));
    saveLook("g1", look("a"));
    expect(names("g1")).toEqual(["a", "b"]);
  });

  it("a look with nothing left to get is not saved", () => {
    saveLook("g1", look("a", []));
    expect(savedLooks("g1")).toEqual([]);
    expect(isLookSaved("g1", "a")).toBe(false);
  });

  it("belongs to its game: a new game starts empty", () => {
    saveLook("g1", look("a"));
    expect(savedLooks("g2")).toEqual([]);
    expect(isLookSaved("g2", "a")).toBe(false);
    saveLook("g2", look("b"));
    expect(names("g2")).toEqual(["b"]);
    expect(savedLooks("g1")).toEqual([]);
  });

  it("cleared when the game is left", () => {
    saveLook("g1", look("a"));
    clearSavedLooks();
    expect(savedLooks("g1")).toEqual([]);
  });
});
