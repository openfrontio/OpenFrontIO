import { afterEach, describe, expect, it } from "vitest";
import type { LoadoutItem } from "../../src/client/components/card/LoadoutItems";
import {
  clearSavedLooks,
  endScreenLookRows,
  isLookSaved,
  MAX_SAVED_LOOKS,
  savedLooks,
  saveLook,
  unsaveLook,
} from "../../src/client/components/card/SavedLooks";

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

// The end screen's look rows: the killer's row (when it shows) then the saved
// looks, filtered against what the viewer owns now.
describe("endScreenLookRows", () => {
  const item = (
    type: LoadoutItem["type"],
    name: string,
    state: LoadoutItem["state"] = "buy",
  ): LoadoutItem => ({
    type,
    item: { name, rarity: "epic", product: null } as never,
    state,
    priceHard: state === "buy" ? 400 : undefined,
  });
  const CARD = item("playerCard", "standard");
  const row = (clientID: string, items: LoadoutItem[]) => ({
    clientID,
    name: `name-${clientID}`,
    items,
  });
  const keys = (rows: ReturnType<typeof endScreenLookRows>) =>
    rows.map((r) => [
      r.clientID,
      r.items.map((i) => `${i.type}:${i.item.name}`),
    ]);

  it("drops items bought after the look was saved", () => {
    const rows = endScreenLookRows(
      [row("a", [item("cardBackground", "bg_a"), item("cardTracker", "wins")])],
      ["cardBackground:bg_a"],
    );
    expect(keys(rows)).toEqual([["a", ["cardTracker:wins"]]]);
  });

  it("skips a row left with nothing to buy", () => {
    const rows = endScreenLookRows(
      [
        row("a", [
          item("cardBackground", "bg_a"),
          item("cardTitle", "t", "earned"),
        ]),
        row("b", [item("cardBackground", "bg_b")]),
      ],
      ["cardBackground:bg_a"],
    );
    expect(keys(rows)).toEqual([["b", ["cardBackground:bg_b"]]]);
  });

  it("offers the player card in the first row only", () => {
    const rows = endScreenLookRows(
      [
        row("killer", [CARD, item("cardBackground", "bg_k")]),
        row("a", [CARD, item("cardBackground", "bg_a")]),
      ],
      [],
    );
    expect(keys(rows)).toEqual([
      ["killer", ["playerCard:standard", "cardBackground:bg_k"]],
      ["a", ["cardBackground:bg_a"]],
    ]);
  });

  it("the first row shown gets the card when an earlier one is skipped", () => {
    const rows = endScreenLookRows(
      [row("a", [CARD]), row("b", [CARD, item("cardBackground", "bg_b")])],
      ["playerCard:standard"],
    );
    expect(keys(rows)).toEqual([["b", ["cardBackground:bg_b"]]]);
  });

  it("no item in two rows at once", () => {
    const rows = endScreenLookRows(
      [
        row("a", [item("cardBackground", "bg_x"), item("cardTracker", "wins")]),
        row("b", [
          item("cardBackground", "bg_x"),
          item("cardTracker", "games"),
        ]),
      ],
      [],
    );
    expect(keys(rows)).toEqual([
      ["a", ["cardBackground:bg_x", "cardTracker:wins"]],
      ["b", ["cardTracker:games"]],
    ]);
  });
});
