// What a Steam buyer is told about the free month their purchase included,
// and when.
//
// The month lands unannounced and ends unannounced. Nothing in the client
// says what it is while it runs, and the only thing that speaks when it ends
// is the username lapse notice, which is written for lapsed subscribers and
// says "your subscription ended... resubscribe". A buyer who never subscribed
// reads that as a hidden subscription they were not told about, which is the
// Steam forum complaint this module exists to answer. Two one-shot notices:
// a welcome while the month is running, and a sign-off once it has ended,
// both saying the same thing — the game stays, free, and only the tier perks
// stop.
//
// The ended notice has to be remembered from the boot that saw the grant:
// once the server's sweep has expired the row it drops out of /users/@me
// entirely, so at the boot that matters there is nothing on the wire to
// recognise a former grant holder by. Hence a per-account record in
// localStorage, written while the grant is visible and consulted after.

import { isGrantedSubscription, type UserMeResponse } from "../core/ApiSchemas";

/** localStorage key holding the SteamGrantStore below. */
export const STEAM_GRANT_NOTICE_KEY = "steamGrantNotice";

/**
 * How many accounts' records to keep. Per-device storage, per-account
 * allowance — the same shape and the same cap as the claim-prompt store in
 * BootInterrupts.ts, for the same reason.
 */
export const STEAM_GRANT_NOTICE_MAX_ACCOUNTS = 8;

export interface SteamGrantRecord {
  /** ISO end of the granted period, as last seen from /users/@me. */
  periodEnd: string;
  /** Tier id of the grant, kept so the sign-off can still name it. */
  tier: string;
  welcomed: boolean;
  endedShown: boolean;
  /** Last boot that observed this record's grant; used only for pruning. */
  seenAt: number;
}

/** One record per account seen on this device, keyed by publicId. */
export type SteamGrantStore = Record<string, SteamGrantRecord>;

export interface SteamGrant {
  tier: string;
  periodEnd: Date;
}

/**
 * The Steam-granted month on this account, or null.
 *
 * A grant with an end date. The other writer of a provider-null row is the
 * admin comp endpoint, which sets no end at all, so a dated grant is a Steam
 * month — the same rule the account panel uses to decide whose copy to show.
 */
export function steamGrantOf(
  userMe: UserMeResponse | false | null,
): SteamGrant | null {
  if (userMe === null || userMe === false) return null;
  const sub = userMe.player.subscription;
  if (!isGrantedSubscription(sub) || !sub?.currentPeriodEnd) return null;
  return { tier: sub.tier, periodEnd: sub.currentPeriodEnd };
}

/**
 * Read the stored map, dropping anything unusable. A malformed entry reads as
 * "never seen", which costs at most one repeated welcome; one bad entry never
 * discards the others.
 */
export function parseSteamGrantStore(raw: string | null): SteamGrantStore {
  if (raw === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return {};
  const store: SteamGrantStore = {};
  for (const [publicId, value] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    if (publicId === "") continue;
    if (typeof value !== "object" || value === null) continue;
    const { periodEnd, tier, welcomed, endedShown, seenAt } = value as Record<
      string,
      unknown
    >;
    if (typeof periodEnd !== "string" || Number.isNaN(Date.parse(periodEnd)))
      continue;
    if (typeof tier !== "string") continue;
    if (typeof welcomed !== "boolean" || typeof endedShown !== "boolean")
      continue;
    if (typeof seenAt !== "number" || !Number.isFinite(seenAt)) continue;
    store[publicId] = { periodEnd, tier, welcomed, endedShown, seenAt };
  }
  return store;
}

/**
 * Bring the store up to date with what /users/@me just said. Returns the same
 * object when nothing changed, so the caller can skip the write.
 *
 * - A visible grant is recorded. A different end date is a different grant
 *   (the Deluxe DLC extends the same row) and starts a fresh record, so the
 *   new span gets its own welcome.
 * - A PAID subscription drops the record outright. The sign-off would be a
 *   lie to someone who has since subscribed, and a later lapse of that paid
 *   subscription must get the ordinary lapse copy, not the after-grant one.
 *   An absent `provider` (older server) counts as paid here too — the safe
 *   side, exactly as `isGrantedSubscription` documents.
 * - No subscription at all leaves the record alone: that is the state the
 *   sign-off is waiting for.
 */
export function recordSteamGrant(
  store: SteamGrantStore,
  userMe: UserMeResponse | false | null,
  now: number,
): SteamGrantStore {
  if (userMe === null || userMe === false) return store;
  const publicId = userMe.player.publicId;
  const sub = userMe.player.subscription;
  const existing = store[publicId];

  if (sub && !isGrantedSubscription(sub)) {
    if (existing === undefined) return store;
    const rest = { ...store };
    delete rest[publicId];
    return rest;
  }

  const grant = steamGrantOf(userMe);
  if (grant === null) return store;
  const periodEnd = grant.periodEnd.toISOString();
  if (existing?.periodEnd === periodEnd && existing.tier === grant.tier) {
    return { ...store, [publicId]: { ...existing, seenAt: now } };
  }
  return prune(
    {
      ...store,
      [publicId]: {
        periodEnd,
        tier: grant.tier,
        welcomed: false,
        endedShown: false,
        seenAt: now,
      },
    },
    publicId,
  );
}

// Keep the account just written, then the most recently seen others. The
// current account is pinned out of the sort for the reason claimPromptShown
// gives: a future timestamp from a wrong clock must not evict the record
// just written.
function prune(store: SteamGrantStore, keep: string): SteamGrantStore {
  const ids = Object.keys(store);
  if (ids.length <= STEAM_GRANT_NOTICE_MAX_ACCOUNTS) return store;
  const others = ids
    .filter((id) => id !== keep)
    .sort((a, b) => store[b].seenAt - store[a].seenAt)
    .slice(0, STEAM_GRANT_NOTICE_MAX_ACCOUNTS - 1);
  const pruned: SteamGrantStore = { [keep]: store[keep] };
  for (const id of others) pruned[id] = store[id];
  return pruned;
}

/** Is the welcome owed on this boot: a running grant nobody has explained? */
export function steamGrantWelcomeDue(
  store: SteamGrantStore,
  userMe: UserMeResponse | false | null,
  now: number,
): boolean {
  const grant = steamGrantOf(userMe);
  if (grant === null || grant.periodEnd.getTime() <= now) return false;
  if (userMe === null || userMe === false) return false;
  const record = store[userMe.player.publicId];
  if (record === undefined) return false;
  return record.periodEnd === grant.periodEnd.toISOString() && !record.welcomed;
}

/**
 * Has this account's Steam month run out, with nothing else entitling them?
 *
 * True between the recorded end and the first paid subscription, whether the
 * server has swept the row yet (subscription null) or not (a grant whose end
 * has passed). A new grant with a later end has already replaced the record
 * by the time this is asked, so it answers false there.
 */
export function steamGrantEnded(
  store: SteamGrantStore,
  userMe: UserMeResponse | false | null,
  now: number,
): SteamGrantRecord | null {
  if (userMe === null || userMe === false) return null;
  const record = store[userMe.player.publicId];
  if (record === undefined) return null;
  if (Date.parse(record.periodEnd) > now) return null;
  const sub = userMe.player.subscription;
  if (sub && !isGrantedSubscription(sub)) return null;
  if (sub?.currentPeriodEnd && sub.currentPeriodEnd.getTime() > now)
    return null;
  return record;
}

/** Is the sign-off owed on this boot: an ended grant nobody has signed off? */
export function steamGrantEndedDue(
  store: SteamGrantStore,
  userMe: UserMeResponse | false | null,
  now: number,
): boolean {
  const record = steamGrantEnded(store, userMe, now);
  return record !== null && !record.endedShown;
}

export function steamGrantWelcomed(
  store: SteamGrantStore,
  publicId: string,
): SteamGrantStore {
  const record = store[publicId];
  if (record === undefined) return store;
  return { ...store, [publicId]: { ...record, welcomed: true } };
}

export function steamGrantEndedShown(
  store: SteamGrantStore,
  publicId: string,
): SteamGrantStore {
  const record = store[publicId];
  if (record === undefined) return store;
  return { ...store, [publicId]: { ...record, endedShown: true } };
}
