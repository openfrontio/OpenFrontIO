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

  it("a look of only earned items is not saved", () => {
    saveLook("g1", look("a", [{ ...ITEM, state: "earned" }]));
    expect(savedLooks("g1")).toEqual([]);
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
          item("cardTracker", "t", "earned"),
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

  // A look is saved with every candidate; the three-item cap applies here,
  // after the filters, so a dropped card doesn't cost a later row a slot.
  it("at most three per row, counted after the filters", () => {
    const four = (who: string) => [
      CARD,
      item("cardBackground", `bg_${who}`),
      item("cardTracker", `wins_${who}`),
      item("cardTracker", `games_${who}`),
    ];
    const rows = endScreenLookRows(
      [row("a", four("a")), row("b", four("b"))],
      [],
    );
    expect(keys(rows)).toEqual([
      [
        "a",
        ["playerCard:standard", "cardBackground:bg_a", "cardTracker:wins_a"],
      ],
      [
        "b",
        ["cardBackground:bg_b", "cardTracker:wins_b", "cardTracker:games_b"],
      ],
    ]);
  });

  it("an item owned since saving lets the next one in", () => {
    const rows = endScreenLookRows(
      [
        row("a", [
          item("cardBackground", "bg_a"),
          item("cardTracker", "wins"),
          item("cardTracker", "games"),
          item("cardTracker", "kills"),
        ]),
      ],
      ["cardBackground:bg_a"],
    );
    expect(keys(rows)).toEqual([
      ["a", ["cardTracker:wins", "cardTracker:games", "cardTracker:kills"]],
    ]);
  });

  // A look saved for its one buyable item (hasSomethingToBuy looks at every
  // candidate) must keep it past the cap: buyable items go first.
  it("three earned items and a buyable fourth: the fourth is kept", () => {
    const rows = endScreenLookRows(
      [
        row("a", [
          item("cardTracker", "t1", "earned"),
          item("cardTracker", "t2", "earned"),
          item("cardTracker", "t3", "earned"),
          item("cardTracker", "wins"),
        ]),
      ],
      [],
    );
    expect(keys(rows)).toEqual([
      ["a", ["cardTracker:wins", "cardTracker:t1", "cardTracker:t2"]],
    ]);
  });

  it("buyable first keeps their own order, and the card stays first", () => {
    const rows = endScreenLookRows(
      [
        row("a", [
          CARD,
          item("cardTracker", "t1", "earned"),
          item("cardBackground", "bg_a"),
        ]),
      ],
      [],
    );
    expect(keys(rows)).toEqual([
      ["a", ["playerCard:standard", "cardBackground:bg_a", "cardTracker:t1"]],
    ]);
  });
});
