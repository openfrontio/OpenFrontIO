import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("../../src/client/CardLoadoutApi", () => ({
  saveCardLoadout: api.save,
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

function me(card: unknown, flares: string[] = []): UserMeResponse {
  return {
    user: {},
    player: { publicId: "p1", flares, card },
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
    expect(api.save).toHaveBeenCalledWith({
      background: "bg_pacific",
      title: "warmonger",
      taunt: "salute",
      trackers: ["wins", "nukes_launched", "games_played"],
    });
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
    expect(editor.draft.rows.tracker).toEqual(["wins", null, "games_played"]);
    expect(editor.changeCount()).toBeGreaterThan(0);
    // Not "Saved": that edit isn't, and Save card takes it.
    expect(editor.saveState).toBe("idle");
    expect(editor.canSave()).toBe(true);
  });

  it("closing the Inventory drops unsaved changes", () => {
    const editor = new CardEditor();
    editor.seed(me(CARD, ["cardTracker:games_played"]));
    editor.pick({ kind: "tracker", index: 2 }, "games_played");
    editor.settle();
    expect(editor.changeCount()).toBe(0);
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
