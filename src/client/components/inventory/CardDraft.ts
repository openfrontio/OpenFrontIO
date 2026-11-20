import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import type { Cosmetics } from "@openfront/shared/CosmeticSchemas";
import {
  MAX_CARD_TRACKERS,
  type TrackerStat,
} from "@openfront/shared/PlayerCardSchemas";
import { type CardLoadoutBody, saveCardLoadout } from "../../CardLoadoutApi";
import type { CardItem, CardItemType } from "../card/CardItems";

/**
 * The Player card tab's editing model: what the server last stored (saved),
 * what the player is building (draft), and the difference between them.
 * Nothing here renders; the tab and the Inventory's unsaved-changes guard
 * both read it, and it outlives the tab's element (the Inventory re-renders
 * its body while a fresh profile loads, e.g. after a purchase).
 *
 * Ordered slots are generic: a row holds an item of a kind. Only trackers
 * exist today; Phase 3 adds badges as another kind, with no new row code.
 */

/** The kinds of item an ordered slot row can hold. Phase 3 adds "badge". */
export type CardSlotKind = "tracker";

export interface CardSlotKindSpec {
  /** The catalogue section its items come from. */
  section: keyof Cosmetics;
  /** The item type (its flare is `<type>:<name>`). */
  type: CardItemType;
  /** How many rows. */
  rows: number;
}

export const CARD_SLOT_KINDS: Record<CardSlotKind, CardSlotKindSpec> = {
  tracker: {
    section: "cardTrackers",
    type: "cardTracker",
    rows: MAX_CARD_TRACKERS,
  },
};

export const CARD_SLOT_KIND_LIST = Object.keys(
  CARD_SLOT_KINDS,
) as CardSlotKind[];

/** A slot on the card: the background, or row `index` of a kind. */
export type CardSlotRef =
  | { kind: "background" }
  | { kind: CardSlotKind; index: number };

export interface CardDraft {
  background: string | null;
  /** Per kind, one entry per row (left to right on the card); null = empty. */
  rows: Record<CardSlotKind, (string | null)[]>;
}

export interface CardChange {
  slot: CardSlotRef;
  from: string | null;
  to: string | null;
}

export function sameSlot(a: CardSlotRef, b: CardSlotRef): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "background") return true;
  return a.index === (b as { index: number }).index;
}

function padRows(names: readonly string[], rows: number): (string | null)[] {
  const out: (string | null)[] = names.slice(0, rows);
  while (out.length < rows) out.push(null);
  return out;
}

/** The draft for a stored card (null: nothing equipped). Tracker rows hold
 * the catalogue item's name, which is its stat: the API names each tracker
 * by its stat, and the picker offers no tracker where they differ. */
export function draftFromCard(
  card: { background?: string | null; trackers?: { stat: string }[] } | null,
): CardDraft {
  return {
    background: card?.background ?? null,
    rows: {
      tracker: padRows(
        (card?.trackers ?? []).map((t) => t.stat),
        CARD_SLOT_KINDS.tracker.rows,
      ),
    },
  };
}

function cloneDraft(draft: CardDraft): CardDraft {
  return {
    background: draft.background,
    rows: Object.fromEntries(
      CARD_SLOT_KIND_LIST.map((kind) => [kind, [...draft.rows[kind]]]),
    ) as CardDraft["rows"],
  };
}

/** Every slot whose item differs, background first, then rows in order. */
export function cardChanges(saved: CardDraft, draft: CardDraft): CardChange[] {
  const changes: CardChange[] = [];
  if (saved.background !== draft.background) {
    changes.push({
      slot: { kind: "background" },
      from: saved.background,
      to: draft.background,
    });
  }
  for (const kind of CARD_SLOT_KIND_LIST) {
    draft.rows[kind].forEach((to, index) => {
      const from = saved.rows[kind][index] ?? null;
      if (from !== to) changes.push({ slot: { kind, index }, from, to });
    });
  }
  return changes;
}

/** Puts `name` in a slot. In a row already holding it elsewhere, the two
 * rows swap (the other row gets what this one held). */
export function pickInto(
  draft: CardDraft,
  slot: CardSlotRef,
  name: string | null,
): CardDraft {
  const next = cloneDraft(draft);
  if (slot.kind === "background") {
    next.background = name;
    return next;
  }
  const rows = next.rows[slot.kind];
  const current = rows[slot.index] ?? null;
  if (name !== null) {
    const elsewhere = rows.indexOf(name);
    if (elsewhere !== -1 && elsewhere !== slot.index) rows[elsewhere] = current;
  }
  rows[slot.index] = name;
  return next;
}

/** Where things would move if `name` were picked into `slot`: the picked
 * item's move, and the displaced item's when it swaps (for the hover hint). */
export function swapPreview(
  draft: CardDraft,
  slot: CardSlotRef,
  name: string,
): {
  moved: string;
  to: number;
  displaced: string | null;
  from: number;
} | null {
  if (slot.kind === "background") return null;
  const rows = draft.rows[slot.kind];
  const from = rows.indexOf(name);
  if (from === -1 || from === slot.index) return null;
  return {
    moved: name,
    to: slot.index,
    displaced: rows[slot.index] ?? null,
    from,
  };
}

/** Moves a row (↑/↓ or a drag): the rows between shift over. */
export function moveRow(
  draft: CardDraft,
  kind: CardSlotKind,
  from: number,
  to: number,
): CardDraft {
  const rows = draft.rows[kind];
  if (from === to || to < 0 || to >= rows.length || from < 0) return draft;
  const next = cloneDraft(draft);
  const [item] = next.rows[kind].splice(from, 1);
  next.rows[kind].splice(to, 0, item);
  return next;
}

/** The loadout to PUT. Held-back fields (title, taunt) go back exactly as
 * stored: a saved one stays saved. Empty rows are left out. */
export function loadoutBody(
  draft: CardDraft,
  held: Pick<CardLoadoutBody, "title" | "taunt">,
): CardLoadoutBody {
  return {
    background: draft.background,
    title: held.title,
    taunt: held.taunt,
    trackers: draft.rows.tracker.filter(
      (s): s is TrackerStat => s !== null,
    ) as TrackerStat[],
  };
}

/** The flare that owns an item in a slot. */
export function flareFor(slot: CardSlotRef, name: string): string {
  const type =
    slot.kind === "background"
      ? "cardBackground"
      : CARD_SLOT_KINDS[slot.kind].type;
  return `${type}:${name}`;
}

/** The catalogue item a slot entry names, if the catalogue has it. */
export function slotItem(
  cosmetics: Cosmetics | null,
  slot: CardSlotRef,
  name: string,
): { type: CardItemType; item: CardItem } | null {
  if (slot.kind === "background") {
    const item = cosmetics?.cardBackgrounds?.[name];
    return item ? { type: "cardBackground", item } : null;
  }
  const spec = CARD_SLOT_KINDS[slot.kind];
  const section = cosmetics?.[spec.section] as
    | Record<string, CardItem>
    | undefined;
  const item = section?.[name];
  return item ? { type: spec.type, item } : null;
}

export type CardSaveState = "idle" | "saving" | "saved" | "failed";

/** How long "Saved" shows before the bar goes. */
export const SAVED_SHOWN_MS = 2000;

/**
 * The tab's state, held by the Inventory. Listeners hear every change.
 */
export class CardEditor {
  saved: CardDraft = draftFromCard(null);
  draft: CardDraft = draftFromCard(null);
  saveState: CardSaveState = "idle";
  /** The held-back fields, sent back unchanged. */
  private held: Pick<CardLoadoutBody, "title" | "taunt"> = {
    title: null,
    taunt: null,
  };
  /** Tracker values the server last sent, for the preview. */
  values = new Map<string, number>();
  private flares: readonly string[] = [];
  private seededFrom: UserMeResponse | null = null;
  private savedTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * The changes were dropped (Discard, or the Inventory closed) while a
   * save was in flight: the draft they were dropped to. Until it's edited
   * again, the draft follows what that save stores.
   */
  private droppedTo: CardDraft | null = null;
  /** The save in flight, for a Save clicked while it runs to wait on. */
  private inFlight: Promise<boolean> | null = null;
  private listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /**
   * Takes the stored card from a new /users/@me. Unsaved changes stay (a
   * purchase broadcasts a fresh profile while they're pending); with none,
   * the draft follows the stored card.
   */
  seed(userMe: UserMeResponse | null): void {
    if (userMe === this.seededFrom) return;
    this.seededFrom = userMe;
    const card = userMe?.player.card ?? null;
    const hadChanges = this.changeCount() > 0;
    this.saved = draftFromCard(card);
    this.held = { title: card?.title ?? null, taunt: card?.taunt ?? null };
    this.values = new Map(
      (card?.trackers ?? []).map((t) => [t.stat, t.value] as const),
    );
    this.flares = userMe?.player.flares ?? [];
    if (!hadChanges) this.draft = cloneDraft(this.saved);
    this.emit();
  }

  /** True once this profile's card has been read (the saved card is it,
   * or what was saved on top of it since). */
  isSeededWith(userMe: UserMeResponse | false | null): boolean {
    return userMe !== false && userMe !== null && userMe === this.seededFrom;
  }

  changes(): CardChange[] {
    return cardChanges(this.saved, this.draft);
  }

  changeCount(): number {
    return this.changes().length;
  }

  owns(flare: string): boolean {
    return this.flares.includes(flare);
  }

  /** The items in the changes the player doesn't own yet, once each. */
  unownedInChanges(): { slot: CardSlotRef; name: string; flare: string }[] {
    const seen = new Set<string>();
    const out: { slot: CardSlotRef; name: string; flare: string }[] = [];
    for (const change of this.changes()) {
      if (change.to === null) continue;
      const flare = flareFor(change.slot, change.to);
      if (this.owns(flare) || seen.has(flare)) continue;
      seen.add(flare);
      out.push({ slot: change.slot, name: change.to, flare });
    }
    return out;
  }

  pick(slot: CardSlotRef, name: string | null): void {
    this.draft = pickInto(this.draft, slot, name);
    this.afterEdit();
  }

  move(kind: CardSlotKind, from: number, to: number): void {
    this.draft = moveRow(this.draft, kind, from, to);
    this.afterEdit();
  }

  discard(): void {
    this.draft = cloneDraft(this.saved);
    this.dropDuringSave();
    this.afterEdit();
  }

  /** `saved` is still the old card while a save runs: dropping the changes
   * then means following what the save stores, not reverting it. */
  private dropDuringSave(): void {
    if (this.saveState === "saving") this.droppedTo = cloneDraft(this.draft);
  }

  private afterEdit(): void {
    // A failed save's Retry is for the changes it failed on, and "Saved"
    // was for the ones just stored: either way the new changes get Save card
    // back at once (a "Saved" button takes no clicks).
    if (this.saveState === "failed" || this.saveState === "saved") {
      this.clearSavedTimer();
      this.saveState = "idle";
    }
    this.emit();
  }

  canSave(): boolean {
    return (
      this.changeCount() > 0 &&
      this.unownedInChanges().length === 0 &&
      this.saveState !== "saving"
    );
  }

  /**
   * Saves the draft. True when stored; on failure the changes stay. Clicked
   * while a save is in flight (the guard's Save), it waits for that one,
   * then saves whatever was changed since.
   */
  async save(): Promise<boolean> {
    if (this.inFlight !== null) {
      if (!(await this.inFlight)) return false;
      return this.changeCount() === 0 || this.save();
    }
    if (!this.canSave()) return false;
    const saving = this.store();
    this.inFlight = saving;
    try {
      return await saving;
    } finally {
      if (this.inFlight === saving) this.inFlight = null;
    }
  }

  private async store(): Promise<boolean> {
    const sent = cloneDraft(this.draft);
    this.clearSavedTimer();
    this.saveState = "saving";
    this.emit();
    const body = loadoutBody(sent, this.held);
    const result = await saveCardLoadout(body);
    if (!result.ok) {
      // Closed meanwhile: its changes are gone, so no Retry is left over.
      this.saveState = this.droppedTo !== null ? "idle" : "failed";
      this.droppedTo = null;
      this.emit();
      return false;
    }
    // What is stored now: the loadout the server answers with, or what was
    // sent. Either way empty rows are gone (the PUT leaves them out), so a
    // gap in the middle closes up, as it will on the next load.
    const stored = Array.isArray(result.loadout?.trackers)
      ? result.loadout
      : body;
    const storedDraft = draftFromCard({
      background: stored.background ?? null,
      trackers: stored.trackers.map((stat) => ({ stat })),
    });
    // Nothing edited while it saved (or the changes were dropped meanwhile,
    // and not edited since): the draft becomes the stored card.
    const dropped =
      this.droppedTo !== null &&
      cardChanges(this.droppedTo, this.draft).length === 0;
    this.droppedTo = null;
    if (dropped || cardChanges(sent, this.draft).length === 0) {
      this.draft = cloneDraft(storedDraft);
    }
    this.saved = storedDraft;
    // An edit made while it saved isn't saved: no "Saved" over it, and
    // Save card takes it at once.
    if (cardChanges(this.saved, this.draft).length > 0) {
      this.saveState = "idle";
      this.emit();
      return true;
    }
    this.saveState = "saved";
    this.savedTimer = setTimeout(() => {
      this.savedTimer = null;
      if (this.saveState === "saved") this.saveState = "idle";
      this.emit();
    }, SAVED_SHOWN_MS);
    this.emit();
    return true;
  }

  private clearSavedTimer(): void {
    if (this.savedTimer !== null) clearTimeout(this.savedTimer);
    this.savedTimer = null;
  }

  /**
   * The Inventory closed. When its guard ran, the changes are already saved
   * or discarded; a close it didn't see (another modal's link, browser
   * Back) drops them, so they never come back later. "Saved" and a failed
   * save's toast go too. A save still in flight finishes, and the draft
   * then follows what it stored.
   */
  settle(): void {
    this.clearSavedTimer();
    this.draft = cloneDraft(this.saved);
    if (this.saveState === "saving") {
      this.dropDuringSave();
    } else {
      this.saveState = "idle";
    }
    this.emit();
  }
}
