import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("../../src/client/CardLoadoutApi", () => ({
  saveCardLoadout: api.save,
}));
// The account the session is signed in as (Auth's currentPublicId).
// `sub` is the session's JWT subject (null: no token for now).
const session = vi.hoisted(() => ({
  id: "p1" as string | null,
  sub: "sub-1" as string | null,
}));
vi.mock("../../src/client/Auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Auth")>()),
  currentPublicId: () => session.id,
  currentSessionSub: () => session.sub,
  isOtherSession: (sub: string) => session.sub !== null && session.sub !== sub,
}));

import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import {
  CARD_SLOT_KINDS,
  CardEditor,
  cardChanges,
  draftFromCard,
  loadoutBody,
  moveRow,
  pickInto,
  replayByItem,
  replayMoves,
  SAVED_SHOWN_MS,
  swapPreview,
} from "../../src/client/components/inventory/CardDraft";

const CARD = {
  background: "bg_pacific",
  title: "warmonger",
  taunt: "salute",
  trackers: [
    { stat: "wins", value: 312 },
    { stat: "nukes_launched", value: 4880 },
    { stat: "best_elo", value: 1612 },
  ],
};

function me(
  card: unknown,
  flares: string[] = [],
  publicId = "p1",
): UserMeResponse {
  return {
    user: {},
    player: { publicId, flares, card },
  } as unknown as UserMeResponse;
}

describe("card draft", () => {
  it("is generic over slot kinds; only trackers exist, three rows", () => {
    expect(Object.keys(CARD_SLOT_KINDS)).toEqual(["tracker"]);
    expect(CARD_SLOT_KINDS.tracker.rows).toBe(3);
  });

  it("pads the stored trackers to three rows", () => {
    const d = draftFromCard({ trackers: [{ stat: "wins" }] });
    expect(d.rows.tracker).toEqual(["wins", null, null]);
    expect(d.background).toBeNull();
  });

  it("picking a stat that's in another row swaps the two", () => {
    const d = draftFromCard(CARD);
    const next = pickInto(d, { kind: "tracker", index: 2 }, "wins");
    expect(next.rows.tracker).toEqual(["best_elo", "nukes_launched", "wins"]);
    // The original is untouched.
    expect(d.rows.tracker[0]).toBe("wins");
  });

  it("the swap hint names both moves", () => {
    const d = draftFromCard(CARD);
    expect(swapPreview(d, { kind: "tracker", index: 2 }, "wins")).toEqual({
      moved: "wins",
      to: 2,
      displaced: "best_elo",
      from: 0,
    });
    expect(swapPreview(d, { kind: "tracker", index: 2 }, "games")).toBeNull();
    expect(swapPreview(d, { kind: "background" }, "wins")).toBeNull();
  });

  it("moves a row up or down; out of range is a no-op", () => {
    const d = draftFromCard(CARD);
    expect(moveRow(d, "tracker", 0, 1).rows.tracker).toEqual([
      "nukes_launched",
      "wins",
      "best_elo",
    ]);
    expect(moveRow(d, "tracker", 2, 0).rows.tracker).toEqual([
      "best_elo",
      "wins",
      "nukes_launched",
    ]);
    expect(moveRow(d, "tracker", 0, -1)).toBe(d);
    expect(moveRow(d, "tracker", 2, 3)).toBe(d);
    // A source row past the end (or before the start) moves nothing either:
    // never an undefined row in the draft.
    expect(moveRow(d, "tracker", 3, 0)).toBe(d);
    expect(moveRow(d, "tracker", -1, 0)).toBe(d);
  });

  it("replaying moves keeps the fresh order except where the player swapped a pair", () => {
    const card = (trackers: string[]) =>
      draftFromCard({ trackers: trackers.map((stat) => ({ stat })) });
    const before = card(["wins", "nukes_launched", "best_elo"]);
    const after = card(["nukes_launched", "wins", "best_elo"]);
    // No move here: the fresh card as it is.
    expect(
      replayMoves(card(["best_elo", "wins"]), before, before).rows.tracker,
    ).toEqual(["best_elo", "wins", null]);
    // Elsewhere Best Elo moved between them: both orders can't hold, and
    // the player's (Nukes before Wins) wins.
    expect(
      replayMoves(card(["wins", "best_elo", "nukes_launched"]), before, after)
        .rows.tracker,
    ).toEqual(["best_elo", "nukes_launched", "wins"]);
  });

  it("lists each changed slot", () => {
    const saved = draftFromCard(CARD);
    const draft = pickInto(
      pickInto(saved, { kind: "tracker", index: 2 }, "games_played"),
      { kind: "background" },
      "bg_storm",
    );
    expect(cardChanges(saved, draft)).toEqual([
      { slot: { kind: "background" }, from: "bg_pacific", to: "bg_storm" },
      {
        slot: { kind: "tracker", index: 2 },
        from: "best_elo",
        to: "games_played",
      },
    ]);
  });

  it("replays edits by the item they name onto a card laid out differently", () => {
    const kept = draftFromCard(CARD); // wins, nukes, best_elo
    // The failed save had taken nukes off; the player then filled the gap.
    const before = draftFromCard({
      trackers: [{ stat: "best_elo" }, { stat: "wins" }],
    });
    const after = pickInto(
      before,
      { kind: "tracker", index: 2 },
      "games_played",
    );
    // No empty row on the kept card: games_played goes where nukes was,
    // which the player never saw.
    expect(replayByItem(kept, before, after).rows.tracker).toEqual([
      "wins",
      "games_played",
      "best_elo",
    ]);
  });

  const rows = (...trackers: (string | null)[]) => ({
    background: null,
    rows: { tracker: trackers },
  });

  it("replaying never overwrites a tracker it placed itself", () => {
    // Kept [A,B,C]; the failed save had cleared B and C; the player then
    // filled both rows with D and E.
    expect(
      replayByItem(
        rows("a", "b", "c"),
        rows("a", null, null),
        rows("a", "d", "e"),
      ).rows.tracker,
    ).toEqual(["a", "d", "e"]);
  });

  it("replaying keeps a replace when a later add needs a row", () => {
    // Kept [A,B,C]; the failed save had cleared C; the player then replaced
    // A with D and filled row 3 with E.
    expect(
      replayByItem(
        rows("a", "b", "c"),
        rows("a", "b", null),
        rows("d", "b", "e"),
      ).rows.tracker,
    ).toEqual(["d", "b", "e"]);
  });

  it("a tracker added into an emptied row keeps its place among the others", () => {
    // [A, -, C] (B taken off), then D picked into the gap; the kept card
    // closed it up: [A, C, -]. D goes between A and C, as the player put it.
    expect(
      replayByItem(
        rows("a", "c", null),
        rows("a", null, "c"),
        rows("a", "d", "c"),
      ).rows.tracker,
    ).toEqual(["a", "d", "c"]);
    // Picked after the others: it still goes last.
    expect(
      replayByItem(
        rows("a", "c", null),
        rows("c", "a", null),
        rows("c", "a", "d"),
      ).rows.tracker,
    ).toEqual(["a", "c", "d"]);
  });

  it("the body keeps held-back title and taunt and drops empty rows", () => {
    const d = pickInto(
      draftFromCard(CARD),
      { kind: "tracker", index: 1 },
      null,
    );
    expect(loadoutBody(d, { title: "warmonger", taunt: "salute" })).toEqual({
      background: "bg_pacific",
      title: "warmonger",
      taunt: "salute",
      trackers: ["wins", "best_elo"],
    });
  });
});

describe("CardEditor", () => {
  beforeEach(() => {
    session.id = "p1";
    session.sub = "sub-1";
    api.save.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("a fresh profile keeps unsaved changes", () => {
    const editor = new CardEditor();
    editor.seed(me(CARD, ["cardBackground:bg_pacific"]));
    editor.pick({ kind: "background" }, "bg_storm");
    editor.seed(
      me(CARD, ["cardBackground:bg_pacific", "cardBackground:bg_storm"]),
    );
    expect(editor.draft.background).toBe("bg_storm");
    expect(editor.unownedInChanges()).toEqual([]);
  });

  it("with no changes the draft follows the stored card", () => {
    const editor = new CardEditor();
    editor.seed(me(CARD));
    editor.seed(me({ ...CARD, background: "bg_x" }));
    expect(editor.draft.background).toBe("bg_x");
  });

  it("an unowned item blocks saving until bought or discarded", () => {
    const editor = new CardEditor();
    editor.seed(me(CARD, ["cardTracker:wins", "cardTracker:best_elo"]));
    editor.pick({ kind: "background" }, "bg_storm");
    expect(editor.unownedInChanges().map((u) => u.flare)).toEqual([
      "cardBackground:bg_storm",
    ]);
    expect(editor.canSave()).toBe(false);
    editor.discard();
    expect(editor.changeCount()).toBe(0);
    expect(editor.unownedInChanges()).toEqual([]);
  });

  it("save sends the held-back fields unchanged and shows Saved for 2 s", async () => {
    api.save.mockResolvedValue({ ok: true, loadout: {} });
    const editor = new CardEditor();
    editor.seed(
      me(CARD, ["cardTracker:games_played", "cardBackground:bg_pacific"]),
    );
    editor.pick({ kind: "tracker", index: 2 }, "games_played");
    const saving = editor.save();
    expect(editor.saveState).toBe("saving");
    expect(await saving).toBe(true);
    expect(api.save).toHaveBeenCalledWith(
      {
        background: "bg_pacific",
        title: "warmonger",
        taunt: "salute",
        trackers: ["wins", "nukes_launched", "games_played"],
      },
      expect.any(Function),
    );
    expect(editor.saveState).toBe("saved");
    expect(editor.changeCount()).toBe(0);
    vi.advanceTimersByTime(SAVED_SHOWN_MS);
    expect(editor.saveState).toBe("idle");
  });

  it("a failed save keeps the changes", async () => {
    api.save.mockResolvedValue({ ok: false, error: "failed" });
    const editor = new CardEditor();
    editor.seed(me(CARD, ["cardTracker:games_played"]));
    editor.pick({ kind: "tracker", index: 2 }, "games_played");
    expect(await editor.save()).toBe(false);
    expect(editor.saveState).toBe("failed");
    expect(editor.changeCount()).toBe(1);
  });

  it("an edit right after a save ends Saved at once, so Save can be clicked", async () => {
    api.save.mockResolvedValue({ ok: true, loadout: {} });
    const editor = new CardEditor();
    editor.seed(
      me(CARD, [
        "cardTracker:games_played",
        "cardTracker:wins",
        "cardTracker:best_elo",
      ]),
    );
    editor.pick({ kind: "tracker", index: 2 }, "games_played");
    await editor.save();
    expect(editor.saveState).toBe("saved");
    editor.pick({ kind: "tracker", index: 2 }, "best_elo");
    editor.pick({ kind: "tracker", index: 1 }, "games_played");
    expect(editor.saveState).toBe("idle");
    expect(editor.canSave()).toBe(true);
    // The old timer doesn't fire into a later save.
    api.save.mockReturnValue(new Promise(() => {}));
    void editor.save();
    vi.advanceTimersByTime(SAVED_SHOWN_MS);
    expect(editor.saveState).toBe("saving");
  });

  it("a save with an empty middle row stores the rows as the server has them", async () => {
    api.save.mockResolvedValue({ ok: true, loadout: {} });
    const editor = new CardEditor();
    editor.seed(me(CARD));
    editor.pick({ kind: "tracker", index: 1 }, null);
    await editor.save();
    // Saved compacts the gap away (the PUT left it out), and the draft
    // follows, so nothing reads as changed.
    expect(editor.saved.rows.tracker).toEqual(["wins", "best_elo", null]);
    expect(editor.draft.rows.tracker).toEqual(["wins", "best_elo", null]);
    expect(editor.changeCount()).toBe(0);
  });

  it("an edit made while saving stays a change afterwards", async () => {
    let finish!: (v: unknown) => void;
    api.save.mockReturnValue(new Promise((r) => (finish = r)));
    const editor = new CardEditor();
    editor.seed(me(CARD, ["cardTracker:games_played"]));
    editor.pick({ kind: "tracker", index: 1 }, null);
    const saving = editor.save();
    editor.pick({ kind: "tracker", index: 2 }, "games_played");
    finish({ ok: true, loadout: {} });
    await saving;
    expect(editor.saved.rows.tracker).toEqual(["wins", "best_elo", null]);
    // The edit (Best Elo replaced with Games played) goes onto the stored
    // card, whose gap the server closed up: one change, where Best Elo is.
    expect(editor.draft.rows.tracker).toEqual(["wins", "games_played", null]);
    expect(editor.changeCount()).toBe(1);
    // Not "Saved": that edit isn't, and Save card takes it.
    expect(editor.saveState).toBe("idle");
    expect(editor.canSave()).toBe(true);
  });

  it("a tracker picked into the gap a save leaves keeps its row when the server closes it up", async () => {
    let finish!: (v: unknown) => void;
    api.save.mockReturnValue(new Promise((r) => (finish = r)));
    const editor = new CardEditor();
    editor.seed(me(CARD, ["cardTracker:games_played"]));
    editor.pick({ kind: "tracker", index: 1 }, null);
    const saving = editor.save();
    editor.pick({ kind: "tracker", index: 1 }, "games_played");
    finish({ ok: true, loadout: {} });
    await saving;
    expect(editor.saved.rows.tracker).toEqual(["wins", "best_elo", null]);
    expect(editor.draft.rows.tracker).toEqual([
      "wins",
      "games_played",
      "best_elo",
    ]);
  });

  it("closing the Inventory drops unsaved changes", () => {
    const editor = new CardEditor();
    editor.seed(me(CARD, ["cardTracker:games_played"]));
    editor.pick({ kind: "tracker", index: 2 }, "games_played");
    editor.settle();
    expect(editor.changeCount()).toBe(0);
  });

  it("a sign-out while the token is read stops the PUT", async () => {
    // saveCardLoadout asks the guard once it holds a token.
    let guard: (() => boolean) | undefined;
    api.save.mockImplementationOnce((_body: unknown, stillWanted) => {
      guard = stillWanted as () => boolean;
      return new Promise(() => {});
    });
    const editor = new CardEditor();
    editor.seed(me(CARD, ["cardTracker:games_played"]));
    editor.pick({ kind: "tracker", index: 2 }, "games_played");
    void editor.save();
    expect(guard!()).toBe(true);
    document.dispatchEvent(new CustomEvent("session-cleared"));
    expect(guard!()).toBe(false);
  });

  it("a save answered after a sign-out isn't taken as the saved card", async () => {
    let finish!: (v: unknown) => void;
    api.save.mockReturnValue(new Promise((r) => (finish = r)));
    const editor = new CardEditor();
    editor.seed(me(CARD, ["cardTracker:games_played"]));
    editor.pick({ kind: "tracker", index: 2 }, "games_played");
    const saving = editor.save();
    document.dispatchEvent(new CustomEvent("session-reauth"));
    finish({ ok: true, loadout: {} });
    expect(await saving).toBe(false);
    expect(editor.saved.rows.tracker[2]).toBe("best_elo");
    expect(editor.saveState).toBe("idle");
  });

  it("closing mid-save: the save lands and the draft follows it", async () => {
    let finish!: (v: unknown) => void;
    api.save.mockReturnValue(new Promise((r) => (finish = r)));
    const editor = new CardEditor();
    editor.seed(me(CARD, ["cardTracker:games_played"]));
    editor.pick({ kind: "tracker", index: 2 }, "games_played");
    const saving = editor.save();
    editor.settle();
    finish({ ok: true, loadout: {} });
    await saving;
    expect(editor.saved.rows.tracker[2]).toBe("games_played");
    expect(editor.changeCount()).toBe(0);
  });

  it("an edit after a close mid-save goes on top of what the save stored", async () => {
    let finish!: (v: unknown) => void;
    api.save.mockReturnValue(new Promise((r) => (finish = r)));
    const editor = new CardEditor();
    editor.seed(
      me(CARD, [
        "cardBackground:bg_pacific",
        "cardBackground:bg_storm",
        "cardTracker:games_played",
      ]),
    );
    editor.pick({ kind: "background" }, "bg_storm");
    const saving = editor.save();
    // Browser Back: the Inventory closes with no guard, then reopens.
    editor.settle();
    editor.pick({ kind: "tracker", index: 0 }, "games_played");
    finish({ ok: true, loadout: {} });
    await saving;
    expect(editor.saved.background).toBe("bg_storm");
    expect(editor.draft.background).toBe("bg_storm");
    expect(editor.draft.rows.tracker[0]).toBe("games_played");
    // Only the tracker: nothing that would put the old background back.
    expect(editor.changes()).toEqual([
      { slot: { kind: "tracker", index: 0 }, from: "wins", to: "games_played" },
    ]);
  });

  it("an edit after a close mid-save hits the tracker it names, not its row in the stored card", async () => {
    let finish!: (v: unknown) => void;
    api.save.mockReturnValue(new Promise((r) => (finish = r)));
    const editor = new CardEditor();
    editor.seed(me(CARD));
    // Clear row 1: the stored card closes the gap, [nukes, best_elo, —].
    editor.pick({ kind: "tracker", index: 0 }, null);
    const saving = editor.save();
    editor.settle();
    // Reopened: remove nukes (row 2 as the player sees it).
    const row = editor.draft.rows.tracker.indexOf("nukes_launched");
    editor.pick({ kind: "tracker", index: row }, null);
    finish({ ok: true, loadout: {} });
    await saving;
    expect(editor.saved.rows.tracker).toEqual([
      "nukes_launched",
      "best_elo",
      null,
    ]);
    expect(editor.draft.rows.tracker).toContain("best_elo");
    expect(editor.draft.rows.tracker).not.toContain("nukes_launched");
    expect(
      loadoutBody(editor.draft, { title: null, taunt: null }).trackers,
    ).toEqual(["best_elo"]);
  });

  it("Discard mid-save, then the save fails: the draft ends on the card the server kept", async () => {
    let finish!: (v: unknown) => void;
    api.save.mockReturnValue(new Promise((r) => (finish = r)));
    const editor = new CardEditor();
    editor.seed(
      me(CARD, ["cardBackground:bg_pacific", "cardBackground:bg_storm"]),
    );
    editor.pick({ kind: "background" }, "bg_storm");
    const saving = editor.save();
    editor.discard();
    finish({ ok: false, error: "failed" });
    await saving;
    expect(editor.draft.background).toBe("bg_pacific");
    expect(editor.changeCount()).toBe(0);
    expect(editor.saveState).toBe("idle");
  });

  /** Moves best_elo to the top and saves, holding the PUT; the Inventory
   * then closes with no guard (browser Back) and reopens. */
  async function moveSaveDrop(editor: CardEditor) {
    let finish!: (v: unknown) => void;
    api.save.mockReturnValue(new Promise((r) => (finish = r)));
    editor.seed(
      me(
        CARD,
        ["wins", "nukes_launched", "best_elo", "games_played"].map(
          (s) => `cardTracker:${s}`,
        ),
      ),
    );
    editor.move("tracker", 2, 0);
    const saving = editor.save();
    editor.settle();
    expect(editor.draft.rows.tracker).toEqual([
      "best_elo",
      "wins",
      "nukes_launched",
    ]);
    return async () => {
      finish({ ok: false, error: "failed" });
      await saving;
    };
  }

  it("a move saved, Back, a tracker removed, the save fails: that tracker goes from the kept card", async () => {
    const editor = new CardEditor();
    const fail = await moveSaveDrop(editor);
    editor.pick({ kind: "tracker", index: 0 }, null);
    await fail();
    expect(editor.draft.rows.tracker).toEqual(["wins", "nukes_launched", null]);
    expect(editor.changes()).toEqual([
      { slot: { kind: "tracker", index: 2 }, from: "best_elo", to: null },
    ]);
  });

  it("a move saved, Back, a tracker replaced, the save fails: the one replaced is the one named", async () => {
    const editor = new CardEditor();
    const fail = await moveSaveDrop(editor);
    editor.pick({ kind: "tracker", index: 0 }, "games_played");
    await fail();
    expect(editor.draft.rows.tracker).toEqual([
      "wins",
      "nukes_launched",
      "games_played",
    ]);
    expect(editor.changes()).toEqual([
      {
        slot: { kind: "tracker", index: 2 },
        from: "best_elo",
        to: "games_played",
      },
    ]);
  });

  /** Owns every tracker and both backgrounds. */
  const ALL = [
    ...["wins", "nukes_launched", "best_elo", "games_played"].map(
      (s) => `cardTracker:${s}`,
    ),
    "cardBackground:bg_pacific",
    "cardBackground:bg_storm",
  ];
  /** Saves with the PUT held, then a close with no guard; returns the
   * failure. */
  function holdSaveDrop(editor: CardEditor) {
    let finish!: (v: unknown) => void;
    api.save.mockReturnValue(new Promise((r) => (finish = r)));
    const saving = editor.save();
    editor.settle();
    return async () => {
      finish({ ok: false, error: "failed" });
      await saving;
    };
  }

  it("a failed save after a drop never replays an edit into a duplicate", async () => {
    const editor = new CardEditor();
    editor.seed(me(CARD, ALL));
    editor.pick({ kind: "tracker", index: 1 }, "games_played");
    const fail = holdSaveDrop(editor);
    // Reopened: nukes into row 1 in place of wins (nukes isn't on the
    // draft, so no swap).
    editor.pick({ kind: "tracker", index: 0 }, "nukes_launched");
    await fail();
    expect(editor.draft.rows.tracker).toEqual([
      null,
      "nukes_launched",
      "best_elo",
    ]);
  });

  it("a background the failed save sent doesn't survive a drop and an edit", async () => {
    const editor = new CardEditor();
    editor.seed(me(CARD, ALL));
    editor.pick({ kind: "background" }, "bg_storm");
    const fail = holdSaveDrop(editor);
    editor.pick({ kind: "tracker", index: 0 }, "games_played");
    await fail();
    expect(editor.draft.background).toBe("bg_pacific");
    expect(editor.changes()).toEqual([
      { slot: { kind: "tracker", index: 0 }, from: "wins", to: "games_played" },
    ]);
  });

  it("a background picked after the drop sticks when the save fails", async () => {
    const editor = new CardEditor();
    editor.seed(me(CARD, ALL));
    editor.pick({ kind: "tracker", index: 0 }, "games_played");
    const fail = holdSaveDrop(editor);
    editor.pick({ kind: "background" }, "bg_storm");
    await fail();
    expect(editor.changes()).toEqual([
      { slot: { kind: "background" }, from: "bg_pacific", to: "bg_storm" },
    ]);
  });

  /** Account B's card: owns what A picked, so nothing but the owner
   * check stops A's draft being saved onto it. */
  const B_CARD = {
    background: "bg_pacific",
    trackers: [{ stat: "games_played", value: 7 }],
  };
  const B_FLARES = [
    "cardBackground:bg_pacific",
    "cardBackground:bg_storm",
    ...["wins", "nukes_launched", "best_elo", "games_played"].map(
      (s) => `cardTracker:${s}`,
    ),
  ];

  it("another account's profile drops this account's unsaved changes", async () => {
    session.id = "account-a";
    const editor = new CardEditor();
    editor.seed(me(CARD, B_FLARES, "account-a"));
    editor.pick({ kind: "background" }, "bg_storm");
    document.dispatchEvent(new CustomEvent("session-reauth"));
    session.id = "account-b";
    editor.seed(me(B_CARD, B_FLARES, "account-b"));
    expect(editor.changeCount()).toBe(0);
    expect(editor.canSave()).toBe(false);
    expect(editor.draft.rows.tracker).toEqual(["games_played", null, null]);
    expect(await editor.save()).toBe(false);
    expect(api.save).not.toHaveBeenCalled();
  });

  it("a profile with no player (signed out) counts as another account", () => {
    session.id = "account-a";
    const editor = new CardEditor();
    editor.seed(me(CARD, B_FLARES, "account-a"));
    editor.pick({ kind: "background" }, "bg_storm");
    editor.seed(null);
    editor.seed(me(CARD, B_FLARES, "account-a"));
    expect(editor.changeCount()).toBe(0);
  });

  it("another account mid-save: A's save isn't taken, and B's card has no changes", async () => {
    let finish!: (v: unknown) => void;
    api.save.mockReturnValue(new Promise((r) => (finish = r)));
    session.id = "account-a";
    const editor = new CardEditor();
    editor.seed(me(CARD, B_FLARES, "account-a"));
    editor.pick({ kind: "background" }, "bg_storm");
    const saving = editor.save();
    document.dispatchEvent(new CustomEvent("session-reauth"));
    session.id = "account-b";
    editor.seed(me(B_CARD, B_FLARES, "account-b"));
    expect(editor.saveState).toBe("idle");
    finish({ ok: true, loadout: {} });
    expect(await saving).toBe(false);
    expect(editor.saved.background).toBe("bg_pacific");
    expect(editor.saved.rows.tracker).toEqual(["games_played", null, null]);
    expect(editor.changeCount()).toBe(0);
    expect(editor.canSave()).toBe(false);
    expect(editor.saveState).toBe("idle");
    expect(api.save).toHaveBeenCalledTimes(1);
  });

  it("another account's profile mid-save, with no session event: the save still isn't taken", async () => {
    let finish!: (v: unknown) => void;
    api.save.mockReturnValue(new Promise((r) => (finish = r)));
    session.id = "account-a";
    const editor = new CardEditor();
    editor.seed(me(CARD, B_FLARES, "account-a"));
    editor.pick({ kind: "background" }, "bg_storm");
    const saving = editor.save();
    session.id = "account-b";
    editor.seed(me(B_CARD, B_FLARES, "account-b"));
    finish({ ok: true, loadout: {} });
    expect(await saving).toBe(false);
    expect(editor.saved.background).toBe("bg_pacific");
    expect(editor.changeCount()).toBe(0);
  });

  it("after a session change, the old account's profile never re-seeds the editor", async () => {
    api.save.mockResolvedValue({ ok: true, loadout: {} });
    session.id = "account-a";
    const editor = new CardEditor();
    const a = me(CARD, B_FLARES, "account-a");
    editor.seed(a);
    document.dispatchEvent(new CustomEvent("session-reauth"));
    editor.dropAccount();
    // The tab re-renders with the modal's profile, still A's.
    editor.seed(a);
    editor.pick({ kind: "tracker", index: 0 }, "games_played");
    expect(editor.canSave()).toBe(false);
    expect(await editor.save()).toBe(false);
    expect(api.save).not.toHaveBeenCalled();
    // B's profile arrives: B's card, and B can save.
    session.id = "account-b";
    editor.seed(me(B_CARD, B_FLARES, "account-b"));
    expect(editor.changeCount()).toBe(0);
    editor.pick({ kind: "background" }, "bg_storm");
    expect(editor.canSave()).toBe(true);
  });

  it("a profile for an account the session isn't signed in as is never seeded", async () => {
    session.id = "account-b";
    const editor = new CardEditor();
    const a = me(CARD, B_FLARES, "account-a");
    editor.seed(a);
    expect(editor.isSeededWith(a)).toBe(false);
    expect(editor.saved.background).toBeNull();
    editor.pick({ kind: "background" }, "bg_storm");
    expect(editor.canSave()).toBe(false);
    expect(await editor.save()).toBe(false);
    expect(api.save).not.toHaveBeenCalled();
  });

  it("the session's account not known yet: nothing is seeded", () => {
    session.id = null;
    const editor = new CardEditor();
    const a = me(CARD, B_FLARES, "account-a");
    editor.seed(a);
    expect(editor.isSeededWith(a)).toBe(false);
    // Known now, and it's this one: taken.
    session.id = "account-a";
    editor.seed(me(CARD, B_FLARES, "account-a"));
    expect(editor.saved.background).toBe("bg_pacific");
  });

  it("a profile while the session's account is briefly unknown keeps the draft", async () => {
    // A failed token refresh drops the token without a session event, so
    // currentPublicId() is null for a while: a profile landing then (one
    // already in flight) must not wipe unsaved changes or the save.
    let finish!: (v: unknown) => void;
    api.save.mockReturnValue(new Promise((r) => (finish = r)));
    session.id = "account-a";
    const editor = new CardEditor();
    editor.seed(me(CARD, B_FLARES, "account-a"));
    editor.pick({ kind: "background" }, "bg_storm");
    const saving = editor.save();
    editor.pick({ kind: "tracker", index: 1 }, "wins");
    session.id = null;
    editor.seed(me(CARD, B_FLARES, "account-a"));
    expect(editor.draft.background).toBe("bg_storm");
    expect(editor.draft.rows.tracker[1]).toBe("wins");
    expect(editor.saveState).toBe("saving");
    session.id = "account-a";
    finish({
      ok: true,
      loadout: {
        background: "bg_storm",
        title: null,
        taunt: null,
        trackers: ["games_played"],
      },
    });
    expect(await saving).toBe(true);
    expect(editor.saved.background).toBe("bg_storm");
  });

  it("the session moving to another account turns Save off at once", async () => {
    session.id = "account-a";
    const editor = new CardEditor();
    editor.seed(me(CARD, B_FLARES, "account-a"));
    editor.pick({ kind: "background" }, "bg_storm");
    expect(editor.canSave()).toBe(true);
    // No event and no new profile yet: only the session says so.
    session.id = "account-b";
    expect(editor.canSave()).toBe(false);
    expect(await editor.save()).toBe(false);
    expect(api.save).not.toHaveBeenCalled();
  });

  it("a discarded account's save in flight neither holds up nor decides the next account's Save", async () => {
    session.id = "account-a";
    // A's PUT never settles.
    api.save.mockReturnValueOnce(new Promise(() => {}));
    const editor = new CardEditor();
    editor.seed(me(CARD, B_FLARES, "account-a"));
    editor.pick({ kind: "background" }, "bg_storm");
    void editor.save();
    // Signed out of A and into B.
    editor.dropAccount();
    session.id = "account-b";
    editor.seed(me(CARD, B_FLARES, "account-b"));
    editor.pick({ kind: "tracker", index: 0 }, "games_played");
    api.save.mockResolvedValueOnce({
      ok: true,
      loadout: {
        background: "bg_pacific",
        title: null,
        taunt: null,
        trackers: ["games_played", "nukes_launched", "best_elo"],
      },
    });
    expect(await editor.save()).toBe(true);
    expect(api.save).toHaveBeenCalledTimes(2);
    expect(api.save.mock.calls[1][0].trackers).toEqual([
      "games_played",
      "nukes_launched",
      "best_elo",
    ]);
  });

  it("after a reauth into the same account, a new save waits for the old PUT, then sends", async () => {
    session.id = "account-a";
    let finishOld!: (v: unknown) => void;
    api.save.mockReturnValueOnce(new Promise((r) => (finishOld = r)));
    const editor = new CardEditor();
    editor.seed(me(CARD, B_FLARES, "account-a"));
    editor.pick({ kind: "background" }, "bg_storm");
    void editor.save();
    // session-reauth into the same account: the editor drops and reseeds.
    editor.dropAccount();
    editor.seed(me(CARD, B_FLARES, "account-a"));
    editor.pick({ kind: "tracker", index: 0 }, "games_played");
    api.save.mockResolvedValueOnce({
      ok: true,
      loadout: {
        background: "bg_pacific",
        title: null,
        taunt: null,
        trackers: ["games_played", "nukes_launched", "best_elo"],
      },
    });
    const saving = editor.save();
    await Promise.resolve();
    await Promise.resolve();
    // Two PUTs for one account never race: the new one waits.
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(editor.saveState).toBe("saving");
    // The old one settles (its answer decides nothing here)...
    finishOld({ ok: false, error: "failed" });
    // ...and the new one goes, and decides.
    expect(await saving).toBe(true);
    expect(api.save).toHaveBeenCalledTimes(2);
    expect(editor.saved.rows.tracker[0]).toBe("games_played");
  });

  it("a queued save goes onto what the earlier PUT stored, even with its refresh lost", async () => {
    session.id = "account-a";
    let finishOld!: (v: unknown) => void;
    api.save.mockReturnValueOnce(new Promise((r) => (finishOld = r)));
    const editor = new CardEditor();
    editor.seed(me(CARD, B_FLARES, "account-a"));
    editor.pick({ kind: "background" }, "bg_storm");
    void editor.save();
    // A reauth into the same account, and its profile read before the
    // first PUT commits: still Pacific.
    editor.dropAccount();
    editor.seed(me(CARD, B_FLARES, "account-a"));
    editor.pick({ kind: "tracker", index: 0 }, "games_played");
    api.save.mockResolvedValueOnce({ ok: true, loadout: {} });
    const saving = editor.save();
    // The first PUT stores Storm; its refresh fails, so no profile shows it.
    finishOld({
      ok: true,
      loadout: {
        background: "bg_storm",
        title: null,
        taunt: null,
        trackers: ["wins", "nukes_launched", "best_elo"],
      },
    });
    expect(await saving).toBe(true);
    // The tracker edit goes onto Storm, never undoing it.
    expect(api.save.mock.calls[1][0].background).toBe("bg_storm");
    expect(api.save.mock.calls[1][0].trackers[0]).toBe("games_played");
  });

  it("a save after an earlier PUT landed unseen goes onto what it stored", async () => {
    session.id = "account-a";
    let finishOld!: (v: unknown) => void;
    api.save.mockReturnValueOnce(new Promise((r) => (finishOld = r)));
    const editor = new CardEditor();
    editor.seed(me(CARD, B_FLARES, "account-a"));
    editor.pick({ kind: "background" }, "bg_storm");
    const first = editor.save();
    editor.dropAccount();
    editor.seed(me(CARD, B_FLARES, "account-a"));
    finishOld({
      ok: true,
      loadout: {
        background: "bg_storm",
        title: null,
        taunt: null,
        trackers: ["wins", "nukes_launched", "best_elo"],
      },
    });
    await first;
    // Settled before the next Save: nothing queued, but it still knows.
    editor.pick({ kind: "tracker", index: 0 }, "games_played");
    api.save.mockResolvedValueOnce({ ok: true, loadout: {} });
    expect(await editor.save()).toBe(true);
    expect(api.save.mock.calls[1][0].background).toBe("bg_storm");
  });

  it("once a profile shows an unseen PUT, a change made elsewhere after it isn't overwritten", async () => {
    session.id = "account-a";
    let finishOld!: (v: unknown) => void;
    api.save.mockReturnValueOnce(new Promise((r) => (finishOld = r)));
    const editor = new CardEditor();
    editor.seed(me(CARD, B_FLARES, "account-a"));
    editor.pick({ kind: "background" }, "bg_storm");
    const first = editor.save();
    editor.dropAccount();
    editor.seed(me(CARD, B_FLARES, "account-a"));
    finishOld({
      ok: true,
      loadout: {
        background: "bg_storm",
        title: null,
        taunt: null,
        trackers: ["wins", "nukes_launched", "best_elo"],
      },
    });
    await first;
    // A later profile shows Storm; then Ocean is set on a phone.
    editor.seed(me({ ...CARD, background: "bg_storm" }, B_FLARES, "account-a"));
    editor.seed(me({ ...CARD, background: "bg_ocean" }, B_FLARES, "account-a"));
    editor.pick({ kind: "tracker", index: 0 }, "games_played");
    api.save.mockResolvedValueOnce({ ok: true, loadout: {} });
    expect(await editor.save()).toBe(true);
    expect(api.save.mock.calls[1][0].background).toBe("bg_ocean");
  });

  it("pending saves are kept per account: A waits only for A's earlier PUT", async () => {
    const stored = (trackers: string[]) => ({
      ok: true,
      loadout: { background: "bg_pacific", title: null, taunt: null, trackers },
    });
    let finishA!: (v: unknown) => void;
    let finishB!: (v: unknown) => void;
    api.save
      .mockReturnValueOnce(new Promise((r) => (finishA = r)))
      .mockReturnValueOnce(new Promise((r) => (finishB = r)));
    const editor = new CardEditor();
    // A starts a save...
    session.id = "account-a";
    editor.seed(me(CARD, B_FLARES, "account-a"));
    editor.pick({ kind: "background" }, "bg_storm");
    void editor.save();
    // ...B signs in and starts one too...
    editor.dropAccount();
    session.id = "account-b";
    editor.seed(me(CARD, B_FLARES, "account-b"));
    editor.pick({ kind: "background" }, "bg_storm");
    void editor.save();
    expect(api.save).toHaveBeenCalledTimes(2);
    // ...and A signs back in with both PUTs still out.
    editor.dropAccount();
    session.id = "account-a";
    editor.seed(me(CARD, B_FLARES, "account-a"));
    editor.pick({ kind: "tracker", index: 0 }, "games_played");
    api.save.mockResolvedValueOnce(
      stored(["games_played", "nukes_launched", "best_elo"]),
    );
    const saving = editor.save();
    await Promise.resolve();
    await Promise.resolve();
    // A's second PUT waits for A's first, never racing it.
    expect(api.save).toHaveBeenCalledTimes(2);
    // A's first settles while B's is still out: A's next goes, without
    // waiting for B's.
    finishA(stored(["wins", "nukes_launched", "best_elo"]));
    expect(await saving).toBe(true);
    expect(api.save).toHaveBeenCalledTimes(3);
    expect(api.save.mock.calls[2][0].trackers[0]).toBe("games_played");
    finishB(stored(["wins", "nukes_launched", "best_elo"]));
  });

  it("a save that waited for an earlier PUT is checked again before it sends", async () => {
    session.id = "account-a";
    let finishOld!: (v: unknown) => void;
    api.save.mockReturnValueOnce(new Promise((r) => (finishOld = r)));
    const editor = new CardEditor();
    editor.seed(me(CARD, B_FLARES, "account-a"));
    editor.pick({ kind: "background" }, "bg_storm");
    void editor.save();
    // A reauth into the same account; the new save waits for the old PUT.
    editor.dropAccount();
    editor.seed(me(CARD, B_FLARES, "account-a"));
    editor.pick({ kind: "tracker", index: 0 }, "games_played");
    const saving = editor.save();
    await Promise.resolve();
    expect(editor.saveState).toBe("saving");
    // Meanwhile a fresh profile says Games played isn't owned (a refund).
    editor.seed(
      me(
        CARD,
        B_FLARES.filter((f) => f !== "cardTracker:games_played"),
        "account-a",
      ),
    );
    finishOld({ ok: false, error: "failed" });
    // No longer saveable: nothing is sent, and nothing is left saving.
    expect(await saving).toBe(false);
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(editor.saveState).toBe("idle");
    expect(editor.draft.rows.tracker[0]).toBe("games_played");
  });

  it("a token refresh that fails while a save waits ends it failed, with a Retry, and nothing sent", async () => {
    session.id = "account-a";
    let finishOld!: (v: unknown) => void;
    api.save.mockReturnValueOnce(new Promise((r) => (finishOld = r)));
    const editor = new CardEditor();
    editor.seed(me(CARD, B_FLARES, "account-a"));
    editor.pick({ kind: "background" }, "bg_storm");
    void editor.save();
    editor.dropAccount();
    editor.seed(me(CARD, B_FLARES, "account-a"));
    editor.pick({ kind: "tracker", index: 0 }, "games_played");
    // The PUT is asked whether it's still wanted once it holds a token.
    let asked: boolean | undefined;
    api.save.mockImplementationOnce(
      async (_body: unknown, stillWanted: () => boolean) => {
        asked = stillWanted();
        return asked
          ? { ok: true, loadout: null }
          : { ok: false, error: "cancelled" };
      },
    );
    const saving = editor.save();
    await Promise.resolve();
    // The session's account can't be read for now (a refresh failed), and
    // the session stays.
    session.id = null;
    finishOld({ ok: false, error: "failed" });
    expect(await saving).toBe(false);
    expect(asked).toBe(false);
    expect(editor.saveState).toBe("failed");
    expect(editor.draft.rows.tracker[0]).toBe("games_played");
  });

  it("a save whose changes a fresh profile already shows after the wait ends done", async () => {
    session.id = "account-a";
    let finishOld!: (v: unknown) => void;
    api.save.mockReturnValueOnce(new Promise((r) => (finishOld = r)));
    const editor = new CardEditor();
    editor.seed(me(CARD, B_FLARES, "account-a"));
    editor.pick({ kind: "background" }, "bg_storm");
    void editor.save();
    editor.dropAccount();
    editor.seed(me(CARD, B_FLARES, "account-a"));
    editor.pick({ kind: "background" }, "bg_storm");
    const saving = editor.save();
    await Promise.resolve();
    // The old PUT stored the same card, and its profile lands first.
    editor.seed(me({ ...CARD, background: "bg_storm" }, B_FLARES, "account-a"));
    finishOld({ ok: true, loadout: null });
    // Nothing left to save: done (the guard's Save then lets the player
    // leave), with nothing sent.
    expect(await saving).toBe(true);
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(editor.changeCount()).toBe(0);
    expect(editor.saveState).toBe("idle");
  });

  it("a save that succeeds after the session moved to another account isn't taken", async () => {
    // Sent as A, then an ordinary token refresh installs B (no session
    // event) before the answer lands.
    session.id = "account-a";
    api.save.mockImplementationOnce(
      async (_body: unknown, stillWanted: () => boolean) => {
        expect(stillWanted()).toBe(true);
        session.id = "account-b";
        return {
          ok: true,
          loadout: {
            background: "bg_storm",
            title: null,
            taunt: null,
            trackers: ["wins", "nukes_launched", "best_elo"],
          },
        };
      },
    );
    const editor = new CardEditor();
    editor.seed(me(CARD, B_FLARES, "account-a"));
    editor.pick({ kind: "background" }, "bg_storm");
    expect(await editor.save()).toBe(false);
    // A's card isn't taken as saved while B is signed in, and no "Saved".
    expect(editor.saved.background).toBe("bg_pacific");
    expect(editor.saveState).toBe("idle");
  });

  it("a save that succeeds after a refresh installed an account whose id isn't known yet isn't taken", async () => {
    // B's publicId isn't stored yet, so currentPublicId() is null: only
    // the session's subject says it's another account.
    session.id = "account-a";
    api.save.mockImplementationOnce(
      async (_body: unknown, stillWanted: () => boolean) => {
        expect(stillWanted()).toBe(true);
        session.id = null;
        session.sub = "sub-b";
        return {
          ok: true,
          loadout: {
            background: "bg_storm",
            title: null,
            taunt: null,
            trackers: ["wins", "nukes_launched", "best_elo"],
          },
        };
      },
    );
    const editor = new CardEditor();
    editor.seed(me(CARD, B_FLARES, "account-a"));
    editor.pick({ kind: "background" }, "bg_storm");
    expect(await editor.save()).toBe(false);
    expect(editor.saved.background).toBe("bg_pacific");
    expect(editor.saveState).toBe("idle");
  });

  it("a session that moves to another account while saving isn't sent", async () => {
    session.id = "account-a";
    api.save.mockImplementation(
      async (_body: unknown, stillWanted: () => boolean) => {
        // The token is read; the session has moved on by then.
        session.id = "account-b";
        return stillWanted()
          ? { ok: true, loadout: {} }
          : { ok: false, error: "cancelled" };
      },
    );
    const editor = new CardEditor();
    editor.seed(me(CARD, B_FLARES, "account-a"));
    editor.pick({ kind: "background" }, "bg_storm");
    expect(await editor.save()).toBe(false);
    // Another account's session now: A's save ends quietly, with no
    // "Couldn't save" and a Retry that couldn't save (Save is off).
    expect(editor.saveState).toBe("idle");
    expect(editor.canSave()).toBe(false);
  });

  it("no session when the token is read: nothing is sent, and the save fails so it can be retried", async () => {
    session.id = "account-a";
    api.save.mockImplementation(
      async (_body: unknown, stillWanted: () => boolean) => {
        // A token refresh failed: no session, but no other account either.
        session.id = null;
        return stillWanted()
          ? { ok: true, loadout: {} }
          : { ok: false, error: "cancelled" };
      },
    );
    const editor = new CardEditor();
    editor.seed(me(CARD, B_FLARES, "account-a"));
    editor.pick({ kind: "background" }, "bg_storm");
    expect(await editor.save()).toBe(false);
    expect(editor.saveState).toBe("failed");
    expect(editor.draft.background).toBe("bg_storm");
    // Signed in as the same account again: Retry is on.
    session.id = "account-a";
    expect(editor.canSave()).toBe(true);
  });

  it("a reauth into the same account re-seeds with its new profile", () => {
    session.id = "account-a";
    const editor = new CardEditor();
    editor.seed(me(CARD, B_FLARES, "account-a"));
    document.dispatchEvent(new CustomEvent("session-reauth"));
    editor.dropAccount();
    const again = me(
      { ...CARD, background: "bg_storm" },
      B_FLARES,
      "account-a",
    );
    editor.seed(again);
    expect(editor.isSeededWith(again)).toBe(true);
    expect(editor.saved.background).toBe("bg_storm");
    editor.pick({ kind: "tracker", index: 0 }, "games_played");
    expect(editor.canSave()).toBe(true);
  });

  it("closing mid-save that then fails leaves no Retry behind", async () => {
    let finish!: (v: unknown) => void;
    api.save.mockReturnValue(new Promise((r) => (finish = r)));
    const editor = new CardEditor();
    editor.seed(me(CARD, ["cardTracker:games_played"]));
    editor.pick({ kind: "tracker", index: 2 }, "games_played");
    const saving = editor.save();
    editor.settle();
    finish({ ok: false, error: "failed" });
    await saving;
    expect(editor.saveState).toBe("idle");
    expect(editor.changeCount()).toBe(0);
  });

  // Owns every item the tests below pick.
  const ALL_OWNED = [
    "cardBackground:bg_pacific",
    "cardBackground:bg_storm",
    ...["wins", "nukes_launched", "best_elo", "games_played"].map(
      (s) => `cardTracker:${s}`,
    ),
  ];

  it("a move made after closing mid-save survives the save failing", async () => {
    let finish!: (v: unknown) => void;
    api.save.mockReturnValueOnce(new Promise((r) => (finish = r)));
    const editor = new CardEditor();
    editor.seed(me(CARD, ALL_OWNED));
    // Only the background changes, then the Inventory closes mid-save.
    editor.pick({ kind: "background" }, "bg_storm");
    const saving = editor.save();
    editor.settle();
    // Reopened: Best Elo moves to the first row.
    editor.move("tracker", 2, 0);
    finish({ ok: false, error: "failed" });
    await saving;
    expect(editor.draft.rows.tracker).toEqual([
      "best_elo",
      "wins",
      "nukes_launched",
    ]);
  });

  it("a tracker removal saved while the background changed isn't two new edits", async () => {
    let finish!: (v: unknown) => void;
    api.save.mockReturnValueOnce(new Promise((r) => (finish = r)));
    const editor = new CardEditor();
    editor.seed(me(CARD, ALL_OWNED));
    // Nukes comes off the middle row, and that's saved...
    editor.pick({ kind: "tracker", index: 1 }, null);
    const saving = editor.save();
    // ...while only the background changes.
    editor.pick({ kind: "background" }, "bg_storm");
    // The server closes the gap up.
    finish({
      ok: true,
      loadout: {
        background: "bg_pacific",
        title: null,
        taunt: null,
        trackers: ["wins", "best_elo"],
      },
    });
    expect(await saving).toBe(true);
    expect(editor.saved.rows.tracker).toEqual(["wins", "best_elo", null]);
    expect(editor.draft.rows.tracker).toEqual(["wins", "best_elo", null]);
    // Only the background is left to save.
    expect(editor.changeCount()).toBe(1);
  });

  it("a fresh profile of the same card keeps the edits and takes what changed elsewhere", async () => {
    const editor = new CardEditor();
    editor.seed(me(CARD, ALL_OWNED));
    // Only a tracker is edited...
    editor.pick({ kind: "tracker", index: 2 }, "games_played");
    // ...when a purchase's refresh brings a background saved on another
    // device.
    editor.seed(me({ ...CARD, background: "bg_storm" }, ALL_OWNED));
    expect(editor.saved.background).toBe("bg_storm");
    // The untouched background follows the fresh card; the edit stays.
    expect(editor.draft.background).toBe("bg_storm");
    expect(editor.draft.rows.tracker).toEqual([
      "wins",
      "nukes_launched",
      "games_played",
    ]);
    expect(editor.changeCount()).toBe(1);
  });

  it("a fresh profile of the same card keeps a local tracker move", () => {
    const editor = new CardEditor();
    editor.seed(
      me(
        {
          background: "bg_pacific",
          trackers: [
            { stat: "wins", value: 1 },
            { stat: "nukes_launched", value: 2 },
          ],
        },
        ALL_OWNED,
      ),
    );
    // Nukes moves to the first row.
    editor.move("tracker", 1, 0);
    // A refresh brings Best Elo, saved elsewhere into the empty row.
    editor.seed(
      me(
        {
          background: "bg_pacific",
          trackers: [
            { stat: "wins", value: 1 },
            { stat: "nukes_launched", value: 2 },
            { stat: "best_elo", value: 3 },
          ],
        },
        ALL_OWNED,
      ),
    );
    expect(editor.draft.rows.tracker).toEqual([
      "nukes_launched",
      "wins",
      "best_elo",
    ]);
    expect(editor.changeCount()).toBeGreaterThan(0);
  });

  it("a newer profile that lands during a save stays the saved card", async () => {
    let finish!: (v: unknown) => void;
    api.save.mockReturnValueOnce(new Promise((r) => (finish = r)));
    const editor = new CardEditor();
    editor.seed(me(CARD, ALL_OWNED));
    editor.pick({ kind: "background" }, "bg_storm");
    const saving = editor.save();
    // The refresh the save broadcasts is already newer: another session
    // changed the trackers after this PUT committed.
    const newer = me(
      {
        background: "bg_storm",
        trackers: [
          { stat: "games_played", value: 9 },
          { stat: "nukes_launched", value: 4880 },
          { stat: "best_elo", value: 1612 },
        ],
      },
      ALL_OWNED,
    );
    editor.seed(newer);
    // Then the PUT's own answer: the card as this save stored it.
    finish({
      ok: true,
      loadout: {
        background: "bg_storm",
        title: null,
        taunt: null,
        trackers: ["wins", "nukes_launched", "best_elo"],
      },
    });
    expect(await saving).toBe(true);
    expect(editor.saved.rows.tracker[0]).toBe("games_played");
    expect(editor.draft.rows.tracker[0]).toBe("games_played");
    expect(editor.changeCount()).toBe(0);
  });

  it("an edit back to the old card during a save stays an edit when the save's refresh lands", async () => {
    let finish!: (v: unknown) => void;
    api.save.mockReturnValueOnce(new Promise((r) => (finish = r)));
    const editor = new CardEditor();
    editor.seed(me(CARD, ALL_OWNED));
    editor.pick({ kind: "background" }, "bg_storm");
    const saving = editor.save();
    // Pacific again while it saves: the same as the old card...
    editor.pick({ kind: "background" }, "bg_pacific");
    // ...then the save's refresh brings Storm.
    editor.seed(me({ ...CARD, background: "bg_storm" }, ALL_OWNED));
    expect(editor.draft.background).toBe("bg_pacific");
    finish({
      ok: true,
      loadout: {
        background: "bg_storm",
        title: null,
        taunt: null,
        trackers: ["wins", "nukes_launched", "best_elo"],
      },
    });
    expect(await saving).toBe(true);
    expect(editor.saved.background).toBe("bg_storm");
    expect(editor.draft.background).toBe("bg_pacific");
    expect(editor.changeCount()).toBe(1);
  });

  it("a failed save goes onto a card changed elsewhere meanwhile, keeping only its edits", async () => {
    let finish!: (v: unknown) => void;
    api.save.mockReturnValueOnce(new Promise((r) => (finish = r)));
    const editor = new CardEditor();
    editor.seed(me(CARD, ALL_OWNED));
    editor.pick({ kind: "tracker", index: 0 }, "games_played");
    const saving = editor.save();
    // Another device changed the background meanwhile.
    editor.seed(me({ ...CARD, background: "bg_storm" }, ALL_OWNED));
    finish({ ok: false, error: "failed" });
    expect(await saving).toBe(false);
    expect(editor.saveState).toBe("failed");
    // Retry sends Storm, which the player never touched, and their tracker.
    expect(editor.draft.background).toBe("bg_storm");
    expect(editor.draft.rows.tracker[0]).toBe("games_played");
    expect(editor.changeCount()).toBe(1);
  });

  it("an older profile that lands during a save doesn't undo it", async () => {
    let finish!: (v: unknown) => void;
    api.save.mockReturnValueOnce(new Promise((r) => (finish = r)));
    const editor = new CardEditor();
    editor.seed(me(CARD, ALL_OWNED));
    editor.pick({ kind: "background" }, "bg_storm");
    const saving = editor.save();
    // A purchase's refresh read before this PUT committed: the old card.
    editor.seed(me(CARD, [...ALL_OWNED, "cardBackground:bg_neon"]));
    finish({
      ok: true,
      loadout: {
        background: "bg_storm",
        title: null,
        taunt: null,
        trackers: ["wins", "nukes_launched", "best_elo"],
      },
    });
    expect(await saving).toBe(true);
    expect(editor.saved.background).toBe("bg_storm");
    expect(editor.draft.background).toBe("bg_storm");
    expect(editor.changeCount()).toBe(0);
  });

  it("a fresh profile keeps its own tracker moves next to a local one", () => {
    // CodeRabbit's example: saved [Wins, Nukes, Best Elo], Nukes moved
    // before Wins here, and a refresh that moved Best Elo to the front.
    const editor = new CardEditor();
    editor.seed(me(CARD, ALL_OWNED));
    editor.move("tracker", 1, 0);
    editor.seed(
      me(
        {
          ...CARD,
          trackers: [
            { stat: "best_elo", value: 1612 },
            { stat: "wins", value: 312 },
            { stat: "nukes_launched", value: 4880 },
          ],
        },
        ALL_OWNED,
      ),
    );
    // Both moves: Best Elo where the refresh put it, Nukes before Wins.
    expect(editor.draft.rows.tracker).toEqual([
      "best_elo",
      "nukes_launched",
      "wins",
    ]);
  });

  it("an edit made during a save goes onto a newer card, keeping what it changed", async () => {
    // CodeRabbit's example: Nukes replaced with Conquests while the save
    // runs, and the post-PUT profile has Wins replaced with Games.
    let finish!: (v: unknown) => void;
    api.save.mockReturnValueOnce(new Promise((r) => (finish = r)));
    const owned = [...ALL_OWNED, "cardTracker:conquests"];
    const editor = new CardEditor();
    editor.seed(me(CARD, owned));
    editor.pick({ kind: "background" }, "bg_storm");
    const saving = editor.save();
    editor.pick({ kind: "tracker", index: 1 }, "conquests");
    editor.seed(
      me(
        {
          ...CARD,
          background: "bg_storm",
          trackers: [
            { stat: "games_played", value: 9 },
            { stat: "nukes_launched", value: 4880 },
            { stat: "best_elo", value: 1612 },
          ],
        },
        owned,
      ),
    );
    finish({
      ok: true,
      loadout: {
        background: "bg_storm",
        title: null,
        taunt: null,
        trackers: ["wins", "nukes_launched", "best_elo"],
      },
    });
    expect(await saving).toBe(true);
    expect(editor.saved.rows.tracker).toEqual([
      "games_played",
      "nukes_launched",
      "best_elo",
    ]);
    // Games stays; only the Conquests edit is pending.
    expect(editor.draft.rows.tracker).toEqual([
      "games_played",
      "conquests",
      "best_elo",
    ]);
    expect(editor.changeCount()).toBe(1);
  });

  it("Discard while a save is in flight: the draft follows what it stores", async () => {
    let finish!: (v: unknown) => void;
    api.save.mockReturnValue(new Promise((r) => (finish = r)));
    const editor = new CardEditor();
    editor.seed(me(CARD, ["cardTracker:games_played"]));
    editor.pick({ kind: "tracker", index: 2 }, "games_played");
    const saving = editor.save();
    editor.discard();
    finish({ ok: true, loadout: {} });
    await saving;
    expect(editor.saved.rows.tracker[2]).toBe("games_played");
    expect(editor.draft.rows.tracker[2]).toBe("games_played");
    expect(editor.changeCount()).toBe(0);
  });

  it("an edit after a mid-save Discard: no change undoes the save", async () => {
    let finish!: (v: unknown) => void;
    api.save.mockReturnValue(new Promise((r) => (finish = r)));
    const editor = new CardEditor();
    editor.seed(
      me(CARD, ["cardBackground:bg_pacific", "cardBackground:bg_storm"]),
    );
    editor.pick({ kind: "background" }, "bg_storm");
    const saving = editor.save();
    // Discard drops only what isn't being saved: the save stands.
    editor.discard();
    expect(editor.draft.background).toBe("bg_storm");
    editor.pick({ kind: "tracker", index: 0 }, null);
    finish({ ok: true, loadout: {} });
    await saving;
    expect(editor.saved.background).toBe("bg_storm");
    expect(editor.changes()).toEqual([
      { slot: { kind: "tracker", index: 0 }, from: "wins", to: null },
    ]);
  });

  it("Save while a save is in flight waits for it, then saves what's left", async () => {
    let finish!: (v: unknown) => void;
    api.save.mockReturnValueOnce(new Promise((r) => (finish = r)));
    api.save.mockResolvedValueOnce({ ok: true, loadout: {} });
    const editor = new CardEditor();
    editor.seed(me(CARD, ["cardTracker:games_played"]));
    editor.pick({ kind: "tracker", index: 2 }, "games_played");
    const first = editor.save();
    editor.pick({ kind: "tracker", index: 0 }, null);
    const second = editor.save();
    finish({ ok: true, loadout: {} });
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(api.save).toHaveBeenCalledTimes(2);
    expect(api.save.mock.calls[1][0].trackers).toEqual([
      "nukes_launched",
      "games_played",
    ]);
    expect(editor.changeCount()).toBe(0);
  });

  it("Save while a save is in flight, with nothing new: true once it lands", async () => {
    let finish!: (v: unknown) => void;
    api.save.mockReturnValueOnce(new Promise((r) => (finish = r)));
    const editor = new CardEditor();
    editor.seed(me(CARD, ["cardTracker:games_played"]));
    editor.pick({ kind: "tracker", index: 2 }, "games_played");
    void editor.save();
    const second = editor.save();
    finish({ ok: true, loadout: {} });
    expect(await second).toBe(true);
    expect(api.save).toHaveBeenCalledTimes(1);
  });
});
