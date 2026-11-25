import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import type { Cosmetics } from "@openfront/shared/CosmeticSchemas";
import {
  MAX_CARD_TRACKERS,
  type TrackerStat,
} from "@openfront/shared/PlayerCardSchemas";
import { currentPublicId, currentSessionSub, isOtherSession } from "../../Auth";
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

/**
 * Replays the player's moves (`before` to `after`) onto `out`, a card
 * rebased onto a fresh one. Only the pairs of items the player put in the
 * other order are reordered: every other pair keeps `out`'s order, so a
 * move made elsewhere stays too. Where the two disagree (a pair the player
 * didn't touch that only fits one way round), the player's move wins.
 * Items `out` holds that either side lacks stay in their rows, and nothing
 * changes when the player moved nothing.
 */
export function replayMoves(
  out: CardDraft,
  before: CardDraft,
  after: CardDraft,
): CardDraft {
  const next = cloneDraft(out);
  for (const kind of CARD_SLOT_KIND_LIST) {
    const was = before.rows[kind];
    const now = after.rows[kind];
    const rows = next.rows[kind];
    // The rows holding an item the player could have moved.
    const at = rows
      .map((x, i) =>
        x !== null && was.includes(x) && now.includes(x) ? i : -1,
      )
      .filter((i) => i !== -1);
    const items = at.map((i) => rows[i] as string);
    // `first` goes before `second`: the player swapped them round.
    const swapped = (first: string, second: string) =>
      now.indexOf(first) < now.indexOf(second) &&
      was.indexOf(first) > was.indexOf(second);
    // Each next row takes the first item (in `out`'s order) that no item
    // still left must go before: the player's order where they changed it,
    // `out`'s everywhere else.
    const left = [...items];
    const ordered: string[] = [];
    while (left.length > 0) {
      const ready = left.find((x) => !left.some((y) => swapped(y, x)))!;
      ordered.push(ready);
      left.splice(left.indexOf(ready), 1);
    }
    at.forEach((i, j) => (rows[i] = ordered[j]));
  }
  return next;
}

/**
 * The player's edits (`before` to `after`) on a newer card `base`: picks by
 * what they name (replayByItem), then the order they gave (replayMoves).
 * What the player didn't touch follows `base`.
 */
function rebase(
  base: CardDraft,
  before: CardDraft,
  after: CardDraft,
): CardDraft {
  return replayMoves(replayByItem(base, before, after), before, after);
}

/** Whether `card` has every part `sent` changed from `replaced` (rows
 * compared without their gaps, which the server closes up). */
function showsSave(
  card: CardDraft,
  replaced: CardDraft,
  sent: CardDraft,
): boolean {
  if (
    sent.background !== replaced.background &&
    card.background !== sent.background
  ) {
    return false;
  }
  const items = (rows: readonly (string | null)[]) =>
    rows.filter((x): x is string => x !== null);
  return CARD_SLOT_KIND_LIST.every(
    (kind) =>
      sameRows(items(sent.rows[kind]), items(replaced.rows[kind])) ||
      sameRows(items(card.rows[kind]), items(sent.rows[kind])),
  );
}

/** The card a PUT stored: the loadout the server answers with, or what was
 * sent. Either way empty rows are gone (the PUT leaves them out), so a gap
 * in the middle closes up, as it will on the next load. */
function storedCard(
  loadout: CardLoadoutBody | undefined,
  body: CardLoadoutBody,
): CardDraft {
  const stored = Array.isArray(loadout?.trackers) ? loadout : body;
  return draftFromCard({
    background: stored.background ?? null,
    trackers: stored.trackers.map((stat) => ({ stat })),
  });
}

function sameRows(
  a: readonly (string | null)[],
  b: readonly (string | null)[],
): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
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

/**
 * Replays the edits that took `before` to `after` onto `base`, a card laid
 * out differently (the one the server kept when a save failed), by what
 * they name rather than by row: a removed item goes from wherever `base`
 * has it, and one picked into a row in place of another replaces that one
 * there. An item added into an empty row takes one of `base`'s empty rows,
 * placed among the items there as the player placed it (see placeAmong),
 * else the row of an item `before` didn't have (one the failed save had
 * taken off, which the player never saw). Where `base` has the very rows
 * `before` had (the failed save didn't touch them), `after`'s rows are
 * taken as they are, moves included. Otherwise moves aren't replayed:
 * `base` keeps its own order.
 */
export function replayByItem(
  base: CardDraft,
  before: CardDraft,
  after: CardDraft,
): CardDraft {
  const out = cloneDraft(base);
  if (before.background !== after.background) {
    out.background = after.background;
  }
  for (const kind of CARD_SLOT_KIND_LIST) {
    const was = before.rows[kind];
    const now = after.rows[kind];
    if (sameRows(base.rows[kind], was)) {
      out.rows[kind] = [...now];
      continue;
    }
    const rows = out.rows[kind];
    const gone = (x: string | null): x is string =>
      x !== null && !now.includes(x);
    const isNew = (y: string | null): y is string =>
      y !== null && !was.includes(y);
    const adds: string[] = [];
    was.forEach((x, i) => {
      if (!gone(x)) return;
      const at = rows.indexOf(x);
      const y = now[i];
      if (isNew(y) && at !== -1) {
        // The kept card may already have it elsewhere (the failed save had
        // taken it off): then it just stays there, never twice.
        rows[at] = rows.includes(y) ? null : y;
      } else {
        if (at !== -1) rows[at] = null;
        if (isNew(y)) adds.push(y);
      }
    });
    now.forEach((y, i) => {
      if (isNew(y) && !gone(was[i])) adds.push(y);
    });
    for (const y of adds) {
      if (rows.includes(y)) continue;
      if (rows.includes(null)) {
        placeAmong(rows, y, now);
        continue;
      }
      // Never a tracker the player has now: that includes every one this
      // replay wrote (each comes from `after`), so nothing it placed is
      // overwritten.
      const at = rows.findIndex(
        (x) => x !== null && !was.includes(x) && !now.includes(x),
      );
      if (at !== -1) rows[at] = y;
    }
  }
  return out;
}

/**
 * Puts `y` into `rows`, which has an empty row, right after the last item
 * `rows` holds of those `now` has before it (first when none): the rows
 * between it and the nearest empty one shift over. So a tracker picked into
 * a gap the server since closed up keeps its place among the others, and
 * one picked last still goes last.
 */
function placeAmong(
  rows: (string | null)[],
  y: string,
  now: readonly (string | null)[],
): void {
  const at =
    Math.max(
      -1,
      ...now
        .slice(0, now.indexOf(y))
        .map((x) => (x === null ? -1 : rows.indexOf(x))),
    ) + 1;
  const after = rows.indexOf(null, at);
  if (after !== -1) {
    rows.splice(after, 1);
    rows.splice(at, 0, y);
    return;
  }
  // No empty row from there on: one before it closes up instead.
  rows.splice(rows.lastIndexOf(null), 1);
  rows.splice(at - 1, 0, y);
}

/** Moves a row (↑/↓ or a drag): the rows between shift over. */
export function moveRow(
  draft: CardDraft,
  kind: CardSlotKind,
  from: number,
  to: number,
): CardDraft {
  const rows = draft.rows[kind];
  if (
    from === to ||
    from < 0 ||
    from >= rows.length ||
    to < 0 ||
    to >= rows.length
  ) {
    return draft;
  }
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

/**
 * Who a save is for, taken once as it starts. Every later question about
 * whether the save is still wanted, or still to be taken, asks this one
 * owner (CardEditor.ownerNow).
 */
interface SaveOwner {
  /** The editor's account generation: bumped whenever its card turns out
   * to be another account's (or none), so an old save never lands on it. */
  generation: number;
  /** The session epoch: bumped at sign-out and at a portal account change. */
  epoch: number;
  /** The card's account (its publicId). */
  publicId: string;
  /** The session's JWT subject (null: no token right then). It names the
   * account even before that account's publicId is stored. */
  sub: string | null;
}

/** How long "Saved" shows before the bar goes. */
export const SAVED_SHOWN_MS = 2000;

/**
 * The tab's state, held by the Inventory. Listeners hear every change.
 */
// Bumped at sign-out (any path: Auth's clearLocalSession announces it) and
// at a portal account change, which swaps the session without one. A save
// started under one session is never sent, nor taken, under the next.
let sessionEpoch = 0;
if (typeof document !== "undefined") {
  const bump = () => {
    sessionEpoch++;
  };
  document.addEventListener("session-cleared", bump);
  document.addEventListener("session-reauth", bump);
}

export class CardEditor {
  /**
   * `sessionAccount` is the publicId the session is signed in as (Auth's
   * currentPublicId). Only that account's profile is seeded, and Save is
   * only on while the card held is that account's: whatever route a
   * profile takes in, another account's card never goes out under this
   * session's token.
   */
  constructor(
    private readonly sessionAccount: () => string | null = currentPublicId,
  ) {}

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
   * The changes were dropped (Discard, or the Inventory closed) while a save
   * was in flight: the draft that save sent, which the draft was reset to.
   * They end on what the server confirms: the stored card if the save lands
   * (edits made since stay, built on what it sent), the old card if it
   * fails (edits made since are replayed on it by what they name: see
   * replayByItem).
   */
  private droppedTo: CardDraft | null = null;
  /** The draft the save in flight sent. */
  private sending: CardDraft | null = null;
  /** This card's save in flight, for a Save clicked while it runs to wait
   * on. */
  private inFlight: Promise<boolean> | null = null;
  /** Every save not yet settled, by account (publicId): the latest one for
   * each, which runs after the one before. A save waits for its account's
   * earlier one, so two PUTs for one account never race, even across a
   * reauth or a switch to another account and back; another account's
   * goes at once, since its PUT can't race this one's. */
  private pending = new Map<string, Promise<boolean>>();
  /** By account: a save's PUT that stored a card once the editor had moved
   * on from it (a reauth into the same account), with what it replaced and
   * sent. That account's next save goes onto it (see catchUp), so a profile
   * read before it committed never makes the next PUT undo it. */
  private landed = new Map<
    string,
    { replaced: CardDraft; sent: CardDraft; stored: CardDraft }
  >();
  /** Bumped when the card turns out to be another account's: a save
   * started before never lands on the next one's card. */
  private generation = 0;
  /** Every profile seeded so far. After a session change none of them is
   * taken again: one still in hand (the modal's, until the new session's
   * /users/@me) is the old account's. */
  private seen = new WeakSet<UserMeResponse>();
  /** A session change happened and no newer profile has come since: Save
   * stays off, so nothing goes out under the new session from the old
   * account's card. */
  private awaitingProfile = false;
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
   * the draft follows the stored card. A profile of another account (or
   * none: signed out) drops them, whatever else is going on.
   */
  seed(userMe: UserMeResponse | null): void {
    if (userMe === this.seededFrom) return;
    // The session's account unknown for now (a token refresh failed, and
    // the session stays): that says nothing about whose card this is, so
    // the draft and a save in flight are left alone. A real sign-out or
    // account change comes through dropAccount() or seed(null).
    if (userMe !== null && this.sessionAccount() === null) return;
    if (userMe !== null && userMe.player.publicId !== this.sessionAccount()) {
      // Not the session's account: never seeded. A card still held from
      // another account goes too, and the editor waits empty for this one's.
      if (this.seededFrom !== null && !this.holdsSessionAccount()) {
        this.clearToEmpty();
      }
      return;
    }
    if (userMe !== null) {
      if (this.awaitingProfile && this.seen.has(userMe)) return;
      this.seen.add(userMe);
      this.awaitingProfile = false;
    }
    const owner = userMe?.player.publicId ?? null;
    const sameAccount =
      owner !== null && owner === (this.seededFrom?.player.publicId ?? null);
    if (!sameAccount) this.resetAccount();
    this.seededFrom = userMe;
    const card = userMe?.player.card ?? null;
    const hadChanges = this.changeCount() > 0;
    const before = this.saved;
    this.saved = draftFromCard(card);
    this.held = { title: card?.title ?? null, taunt: card?.taunt ?? null };
    this.values = new Map(
      (card?.trackers ?? []).map((t) => [t.stat, t.value] as const),
    );
    this.flares = userMe?.player.flares ?? [];
    // A profile of this account that shows a PUT stored unseen has caught
    // up with it: from here the profiles are the baseline (one changed
    // elsewhere since must not be rebased back onto that PUT's card).
    if (owner !== null) {
      const landed = this.landed.get(owner);
      if (
        landed !== undefined &&
        showsSave(this.saved, landed.replaced, landed.sent)
      ) {
        this.landed.delete(owner);
      }
    }
    if (this.sending !== null) {
      // A save in flight: the draft is left as it is, even with no changes
      // against the old card (an edit back to it after Save is still an
      // edit). store() reconciles it with what was sent, and this profile
      // may be that save's own refresh.
    } else if (!hadChanges) {
      this.draft = cloneDraft(this.saved);
    } else if (sameAccount) {
      // The same card again, changed elsewhere (saved on another device):
      // the edits made on the old one go onto it, and what wasn't edited
      // follows it, so Save never puts back what the player didn't touch.
      this.draft = rebase(this.saved, before, this.draft);
    }
    this.emit();
  }

  /**
   * The session changed (signed out, or another account): unsaved changes
   * and a save in flight belong to a card that's no longer this one. The
   * draft goes back to the saved card, nothing is left to Retry, and the
   * next /users/@me is taken whoever it's for.
   */
  dropAccount(): void {
    this.resetAccount();
    this.awaitingProfile = true;
    this.emit();
  }

  /** The card held is the session's account's. */
  private holdsSessionAccount(): boolean {
    const held = this.seededFrom?.player.publicId;
    return held !== undefined && held === this.sessionAccount();
  }

  /** No card: what a profile not yet seeded shows. */
  private clearToEmpty(): void {
    this.resetAccount();
    this.saved = draftFromCard(null);
    this.draft = draftFromCard(null);
    this.held = { title: null, taunt: null };
    this.values = new Map();
    this.flares = [];
    this.emit();
  }

  /** Another account's card from here: nothing of the last one's stays. */
  private resetAccount(): void {
    this.generation++;
    // The last card's save in flight is no longer this editor's to wait on:
    // its answer decides nothing (ownerNow says it's gone). It stays in
    // `pending`, so a later Save for that same account still waits for it.
    this.inFlight = null;
    this.clearSavedTimer();
    this.seededFrom = null;
    this.draft = cloneDraft(this.saved);
    this.droppedTo = null;
    this.sending = null;
    this.saveState = "idle";
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

  /** Drops the changes not saved. While a save runs, that's only the
   * edits made since it started: `saved` is still the card it replaces, and
   * going back to that would undo the save once it lands. */
  discard(): void {
    if (this.sending !== null) {
      this.dropToSending(this.sending);
    } else {
      this.draft = cloneDraft(this.saved);
    }
    this.afterEdit();
  }

  /** Drops the changes while a save runs: to what it sent (`saved` is still
   * the card it replaces, and going back to that would undo it). */
  private dropToSending(sending: CardDraft): void {
    this.draft = cloneDraft(sending);
    this.droppedTo = cloneDraft(sending);
  }

  /** Resolves once no save is in flight (at once when none is). */
  async whenSaved(): Promise<void> {
    while (this.inFlight !== null) await this.inFlight;
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
    return this.saveState !== "saving" && this.eligible();
  }

  /** The changes could be saved, a save running aside: the card is the
   * session's account's, and every item in the changes is owned. */
  private eligible(): boolean {
    return (
      !this.awaitingProfile &&
      this.holdsSessionAccount() &&
      this.changeCount() > 0 &&
      this.unownedInChanges().length === 0
    );
  }

  /** Who a save starting now is for. Only called once canSave() holds, so
   * the card is the session's account's. */
  private captureOwner(): SaveOwner {
    return {
      generation: this.generation,
      epoch: sessionEpoch,
      publicId: this.seededFrom!.player.publicId!,
      sub: currentSessionSub(),
    };
  }

  /**
   * Whether the save `owner` started is still this card's and this
   * session's: "gone" once the editor moved to another card, or the
   * session ended or changed account (by its subject, or by its publicId);
   * "unknown" while the session's account can't be read (a token refresh
   * failed, and the session stays), which isn't another account.
   */
  private ownerNow(owner: SaveOwner): "ours" | "unknown" | "gone" {
    if (this.generation !== owner.generation || sessionEpoch !== owner.epoch) {
      return "gone";
    }
    if (owner.sub !== null && isOtherSession(owner.sub)) return "gone";
    const signedInAs = this.sessionAccount();
    if (signedInAs === null) return "unknown";
    return signedInAs === owner.publicId ? "ours" : "gone";
  }

  /** Ends a save that isn't to be taken, with nothing to Retry. An editor
   * on another card since is left alone: its state is that card's. */
  private endQuietly(owner: SaveOwner): false {
    if (this.generation === owner.generation) {
      this.sending = null;
      this.droppedTo = null;
      this.saveState = "idle";
      this.emit();
    }
    return false;
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
    const owner = this.captureOwner();
    // An earlier save of this account's still out (dropped by a reauth, or
    // by a switch to another account and back): this one waits for it.
    const prior = this.pending.get(owner.publicId) ?? null;
    if (prior === null && this.catchUp(owner.publicId) && !this.eligible()) {
      // What an earlier save stored already holds the changes.
      this.emit();
      return this.changeCount() === 0;
    }
    const saving =
      prior === null ? this.store(owner) : this.storeAfter(prior, owner);
    this.inFlight = saving;
    this.pending.set(owner.publicId, saving);
    try {
      return await saving;
    } finally {
      if (this.inFlight === saving) this.inFlight = null;
      if (this.pending.get(owner.publicId) === saving) {
        this.pending.delete(owner.publicId);
      }
    }
  }

  /**
   * Stores once `prior` (that account's earlier save) has settled, however
   * it ends. Nothing is sent if the save is no longer this card's, or the
   * changes can no longer be saved (a fresh profile meanwhile may have
   * taken an item away, or brought the changes to nothing).
   */
  private async storeAfter(
    prior: Promise<unknown>,
    owner: SaveOwner,
  ): Promise<boolean> {
    this.saveState = "saving";
    this.emit();
    await prior.catch(() => undefined);
    const now = this.ownerNow(owner);
    if (now === "gone") return this.endQuietly(owner);
    this.catchUp(owner.publicId);
    // The account unknown for now (a token refresh failed) isn't a reason
    // to drop it: store() asks again before sending, refuses, and ends it
    // failed, so the same account can retry once it's back.
    if (now === "ours" && !this.eligible()) {
      this.endQuietly(owner);
      // Nothing left to save (a fresh profile already shows the changes)
      // is done, as for a Save that waited on this card's own save.
      return this.changeCount() === 0;
    }
    return this.store(owner);
  }

  /**
   * Puts this account's card onto what an earlier save stored unseen (see
   * `landed`), unless the saved card already shows it: the player's edits
   * are replayed on it. True when it moved the card.
   */
  private catchUp(publicId: string): boolean {
    const landed = this.landed.get(publicId);
    if (landed === undefined) return false;
    this.landed.delete(publicId);
    if (showsSave(this.saved, landed.replaced, landed.sent)) return false;
    const before = this.saved;
    this.saved = cloneDraft(landed.stored);
    this.draft = rebase(this.saved, before, this.draft);
    return true;
  }

  private async store(owner: SaveOwner): Promise<boolean> {
    const sent = cloneDraft(this.draft);
    this.sending = sent;
    this.clearSavedTimer();
    this.saveState = "saving";
    this.emit();
    const body = loadoutBody(sent, this.held);
    // The profile the editor held as the save started, and the card it
    // replaced: a profile seeded while it ran is kept over the PUT's answer
    // only if it already shows this save.
    const seededAtStart = this.seededFrom;
    const replaced = cloneDraft(this.saved);
    // Asked once the token is read, right before the PUT (reading it can
    // wait on a JWT refresh, which can pick up another tab's sign-in): sent
    // only while the owner is plainly still signed in.
    const result = await saveCardLoadout(
      body,
      () => this.ownerNow(owner) === "ours",
    );
    // Signed out, into another account, or the editor on another card by
    // now (another tab's sign-in, picked up by an ordinary refresh, fires no
    // session event): whatever it stored isn't this card's, so it isn't
    // taken as the saved card, and there's nothing to Retry. The next
    // /users/@me seeds the editor. The account unknown for now (a refresh
    // that failed) isn't another account: a failure there can be retried
    // once it's back, and a success is taken.
    if (this.ownerNow(owner) === "gone") {
      // Stored for an editor that moved on, but the same account may come
      // back to a profile read before this committed: its next save goes
      // onto this.
      if (result.ok) {
        this.landed.set(owner.publicId, {
          replaced,
          sent,
          stored: storedCard(result.loadout, body),
        });
      }
      return this.endQuietly(owner);
    }
    this.sending = null;
    if (!result.ok) {
      // Dropped meanwhile: the draft goes back to the card the server kept,
      // with any edit made since, and no Retry is left over.
      const droppedTo = this.droppedTo;
      this.droppedTo = null;
      if (droppedTo !== null) {
        this.draft = replayByItem(this.saved, droppedTo, this.draft);
      } else {
        // Kept for Retry: the player's edits (against the card it replaced)
        // go onto the saved card, which a profile meanwhile may have made a
        // newer one, so Retry never puts back what changed elsewhere.
        this.draft = rebase(this.saved, replaced, this.draft);
      }
      this.saveState = droppedTo !== null ? "idle" : "failed";
      this.emit();
      return false;
    }
    // A profile of this account that arrived while it saved and already
    // shows what this save changed was read after the PUT (the refresh the
    // save broadcasts, or a later one): it may be newer than the PUT's
    // answer (another session saved since), so that card stays the saved
    // one. seed() already took it as `saved`. One that doesn't show it was
    // read before the PUT committed (a purchase's refresh): the PUT's
    // answer wins.
    const newerProfile =
      this.seededFrom !== seededAtStart &&
      this.seededFrom !== null &&
      showsSave(this.saved, replaced, sent);
    const storedDraft = newerProfile
      ? cloneDraft(this.saved)
      : storedCard(result.loadout, body);
    // Nothing edited while it saved (or since a drop, which reset the draft
    // to what it sent): the draft becomes the stored card. An edit made
    // meanwhile goes onto the stored card, which may be a newer one: only
    // what was changed since `sent` (a slot's pick, or the order) is
    // replayed, so a part changed elsewhere stays changed, and a gap the
    // server closed up isn't two new edits.
    this.droppedTo = null;
    this.draft =
      cardChanges(sent, this.draft).length === 0
        ? cloneDraft(storedDraft)
        : rebase(storedDraft, sent, this.draft);
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
    if (this.sending !== null) {
      this.dropToSending(this.sending);
    } else {
      this.draft = cloneDraft(this.saved);
      this.saveState = "idle";
    }
    this.emit();
  }
}
