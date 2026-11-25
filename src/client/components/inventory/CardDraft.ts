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
 * there. An item added into an empty row takes `base`'s first empty row,
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
      let at = rows.indexOf(null);
      // Never a tracker the player has now: that includes every one this
      // replay wrote (each comes from `after`), so nothing it placed is
      // overwritten.
      if (at === -1) {
        at = rows.findIndex(
          (x) => x !== null && !was.includes(x) && !now.includes(x),
        );
      }
      if (at !== -1) rows[at] = y;
    }
  }
  return out;
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
  /** The save in flight, for a Save clicked while it runs to wait on. */
  private inFlight: Promise<boolean> | null = null;
  /** A save left in flight when the account was dropped, and whose card it
   * was. A reauth into that same account waits for it to settle before
   * sending (two PUTs for one account never race); another account's save
   * goes at once, since its PUT can't race this one's. */
  private abandoned: {
    promise: Promise<unknown>;
    owner: string | null;
  } | null = null;
  /** Bumped when the card turns out to be another account's: a save
   * started before never lands on the next one's card. */
  private account = 0;
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
    if (!hadChanges) {
      this.draft = cloneDraft(this.saved);
    } else if (
      sameAccount &&
      this.sending === null &&
      this.droppedTo === null
    ) {
      // The same card again, changed elsewhere (saved on another device):
      // the edits made on the old one go onto it, and what wasn't edited
      // follows it, so Save never puts back what the player didn't touch.
      // Not while a save is in flight: store() reconciles with what it
      // stored, and this profile may be that save's own refresh.
      this.draft = replayByItem(this.saved, before, this.draft);
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
    this.account++;
    // The last account's save in flight is no longer this editor's to wait
    // on: its answer (store() sees the account changed) decides nothing,
    // and another account's Save sends at once. A Save for the same account
    // (a reauth) waits for it to settle first: see afterAbandoned().
    if (this.inFlight !== null) {
      const abandoned = {
        promise: this.inFlight,
        owner: this.seededFrom?.player.publicId ?? null,
      };
      this.abandoned = abandoned;
      void abandoned.promise
        .catch(() => undefined)
        .finally(() => {
          if (this.abandoned === abandoned) this.abandoned = null;
        });
    }
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
    return (
      !this.awaitingProfile &&
      this.holdsSessionAccount() &&
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
    const prior = this.abandonedForThisAccount();
    const saving = prior === null ? this.store() : this.storeAfter(prior);
    this.inFlight = saving;
    try {
      return await saving;
    } finally {
      if (this.inFlight === saving) this.inFlight = null;
    }
  }

  /** A save of this same account's left in flight by a reauth, if any. */
  private abandonedForThisAccount(): Promise<unknown> | null {
    const prior = this.abandoned;
    const owner = this.seededFrom?.player.publicId ?? null;
    return prior !== null && prior.owner === owner ? prior.promise : null;
  }

  /**
   * Stores once `prior` (that save) has settled, however it ends. Nothing
   * is sent if the account changed meanwhile: the save is no longer this
   * card's.
   */
  private async storeAfter(prior: Promise<unknown>): Promise<boolean> {
    const account = this.account;
    this.saveState = "saving";
    this.emit();
    await prior.catch(() => undefined);
    if (this.account !== account) return false;
    return this.store();
  }

  private async store(): Promise<boolean> {
    const sent = cloneDraft(this.draft);
    this.sending = sent;
    this.clearSavedTimer();
    this.saveState = "saving";
    this.emit();
    const body = loadoutBody(sent, this.held);
    // Asked again once the token is read: that can wait on a JWT refresh,
    // and a sign-out meanwhile must not send this card under the next
    // session's token.
    const epoch = sessionEpoch;
    const account = this.account;
    const owner = this.seededFrom?.player.publicId ?? null;
    // The session's subject as the save starts: the account it's for, even
    // when another account's publicId isn't known yet.
    const ownerSub = currentSessionSub();
    // Asked once the token is read, right before the PUT: still the session
    // it started under, and still signed in as this card's account.
    const result = await saveCardLoadout(
      body,
      () => sessionEpoch === epoch && this.sessionAccount() === owner,
    );
    // Another account's card by now: dropAccount() has reset the editor,
    // and anything since is that account's.
    if (this.account !== account) return false;
    this.sending = null;
    if (sessionEpoch !== epoch) {
      // Signed out, or into another account, while it saved: whatever it
      // stored belongs to a session that's gone, so it isn't taken as the
      // saved card, and there's nothing to Retry. The next /users/@me
      // seeds the editor.
      this.droppedTo = null;
      this.saveState = "idle";
      this.emit();
      return false;
    }
    if (!result.ok) {
      // Dropped meanwhile: the draft goes back to the card the server kept,
      // with any edit made since, and no Retry is left over.
      const droppedTo = this.droppedTo;
      this.droppedTo = null;
      if (droppedTo !== null) {
        this.draft = replayByItem(this.saved, droppedTo, this.draft);
      }
      // Signed in as another account by now (another tab's sign-in, picked
      // up by a refresh, fires no session event): not this card's failure,
      // and Save is off, so it ends quietly rather than offering a Retry
      // that can't save. No session at all (a refresh that failed) still
      // ends failed: the same account can retry once it's back.
      const signedInAs = this.sessionAccount();
      const otherAccount = signedInAs !== null && signedInAs !== owner;
      this.saveState = droppedTo !== null || otherAccount ? "idle" : "failed";
      this.emit();
      return false;
    }
    // Stored, but the session is another account's by now (an ordinary
    // token refresh installed it after the PUT went, with no session
    // event): that card isn't this editor's to take as saved. The next
    // profile seeds it. Unknown for now (a refresh that failed) isn't
    // another account.
    const signedInAs = this.sessionAccount();
    if (
      (signedInAs !== null && signedInAs !== owner) ||
      (ownerSub !== null && isOtherSession(ownerSub))
    ) {
      this.droppedTo = null;
      this.saveState = "idle";
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
    // Nothing edited while it saved (or since a drop, which reset the draft
    // to what it sent): the draft becomes the stored card. An edit made
    // meanwhile is kept as it is: it was made on what was sent, which the
    // stored card only differs from by closed-up gaps, so it names the
    // same trackers.
    this.droppedTo = null;
    if (cardChanges(sent, this.draft).length === 0) {
      this.draft = cloneDraft(storedDraft);
    } else {
      // Edited while it saved: each part left as it was sent follows the
      // stored card (a gap the server closed up isn't two new edits).
      const draft = cloneDraft(this.draft);
      if (draft.background === sent.background) {
        draft.background = storedDraft.background;
      }
      for (const kind of CARD_SLOT_KIND_LIST) {
        if (sameRows(draft.rows[kind], sent.rows[kind])) {
          draft.rows[kind] = [...storedDraft.rows[kind]];
        }
      }
      this.draft = draft;
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
    if (this.sending !== null) {
      this.dropToSending(this.sending);
    } else {
      this.draft = cloneDraft(this.saved);
      this.saveState = "idle";
    }
    this.emit();
  }
}
