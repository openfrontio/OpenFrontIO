import {
  type ExperimentAssignment,
  type ExperimentExposureBody,
  type ExperimentExposureSurface,
  ExperimentsResponseSchema,
} from "@openfront/shared/ApiSchemas";
import { getApiBase } from "./ApiBase";
import { peekAuthHeader, userAuth } from "./Auth";
import { storePlatform } from "./StoreTracking";

// Store experiments: which test group the signed-in player is in, the catalog
// cohort that group is priced with, and the exposures that count them in a
// test (infra lib/Experiments.ts). Small and safe for the homepage.
//
// Fail safe throughout: signed out, Steam, or any error from the endpoint is
// "no experiments": the plain catalog, no exposures, purchases unchanged.
// Nothing here ever blocks the store.

/** The surface whose tests price the daily flash deal. */
export const FLASH_SALE_DEPTH = "flash_sale_depth";

/** Dispatched on `document` each time a new set of assignments is known. */
export const EXPERIMENTS_CHANGED = "experimentsChanged";
/** Dispatched on `document` (Cosmetics.ts) when a refetched catalog lands. */
export const COSMETICS_CHANGED = "cosmeticsChanged";

const REQUEST_TIMEOUT_MS = 5_000;
// Same rule as a store analytics impression (StoreTracking.ts).
const EXPOSURE_MS = 1000;
const EXPOSURE_RATIO = 0.5;
const EXPOSURE_STORAGE_PREFIX = "experimentExposure:";
// Set while the last load on this device was for a signed-in player, so the
// next page load knows (synchronously, before auth) whether its catalog
// should wait for a group. Signed-out players never wait.
const SIGNED_IN_HINT_KEY = "experimentsSignedIn";

export interface ExperimentsState {
  /** Bumped by every published state; a catalog is tagged with it. */
  generation: number;
  /** The JWT subject the state was loaded for, or null when signed out. */
  account: string | null;
  assignments: ExperimentAssignment[];
  catalogCohort: string | null;
}

let generation = 0;
let current: {
  account: string | null;
  promise: Promise<ExperimentsState>;
} | null = null;
let published: ExperimentsState | null = null;
let expected = false;
const publishWaiters = new Set<(state: ExperimentsState) => void>();
// The experiments generation of the catalog the store and banner render,
// set by Cosmetics.ts. Null for a catalog fetched before the assignment was
// known: it never sends an exposure, in any group.
let catalogGeneration: number | null = null;

/**
 * Main calls this before any component loads, so a catalog fetched before
 * auth settles waits (briefly) for the player's group instead of going out
 * without it. Only when the last load here was signed in: a signed-out
 * player (or Steam) never waits, and a first signed-in visit fetches plain
 * and refetches once the group lands. Without this call, as in tests, the
 * catalog never waits for a load that hasn't started.
 */
export function expectExperiments(): void {
  try {
    expected =
      platform() !== "steam" &&
      localStorage.getItem(SIGNED_IN_HINT_KEY) !== null;
  } catch {
    expected = false;
  }
}

function rememberSignedIn(signedIn: boolean): void {
  try {
    if (signedIn) localStorage.setItem(SIGNED_IN_HINT_KEY, "1");
    else localStorage.removeItem(SIGNED_IN_HINT_KEY);
  } catch {
    // Storage blocked: the next load just doesn't wait.
  }
}

function platform(): "web" | "crazygames" | "steam" {
  return storePlatform();
}

async function currentAccount(): Promise<{
  account: string;
  auth: string;
} | null> {
  // The cached token decides signed-in without ever starting a refresh: a
  // signed-out player makes no auth call and no experiments call.
  try {
    if (peekAuthHeader() === "") return null;
    const auth = await userAuth();
    if (auth === false) return null;
    return { account: auth.claims.sub, auth: `Bearer ${auth.jwt}` };
  } catch {
    return null;
  }
}

async function fetchAssignments(
  auth: string,
): Promise<Pick<ExperimentsState, "assignments" | "catalogCohort">> {
  const empty = { assignments: [], catalogCohort: null };
  try {
    const url = new URL(`${getApiBase()}/users/@me/experiments`);
    url.searchParams.set("platform", platform());
    const response = await fetch(url.toString(), {
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return empty;
    const parsed = ExperimentsResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      console.warn("experiments: unexpected response shape");
      return empty;
    }
    return parsed.data;
  } catch {
    // Offline, timed out, or blocked: the plain store.
    return empty;
  }
}

function publish(state: ExperimentsState): void {
  published = state;
  rememberSignedIn(state.account !== null);
  for (const resolve of publishWaiters) resolve(state);
  publishWaiters.clear();
  document.dispatchEvent(
    new CustomEvent(EXPERIMENTS_CHANGED, { detail: state }),
  );
  exposureWatcher.recheck();
}

/**
 * The player's test groups, memoised per account. A different account (a
 * sign-in, an account switch, a logout) drops the memo and loads afresh;
 * when that load lands, EXPERIMENTS_CHANGED tells Cosmetics.ts to refetch
 * the catalog. Signed out, or on Steam, it makes no request at all.
 */
export async function loadExperiments(): Promise<ExperimentsState> {
  const who = await currentAccount();
  const account = who?.account ?? null;
  if (current !== null && current.account === account) return current.promise;
  // Current before the body runs: signed out or on Steam it finishes with no
  // await, and must still find itself current to publish.
  const entry = { account } as NonNullable<typeof current>;
  current = entry;
  entry.promise = (async () => {
    let result: Pick<ExperimentsState, "assignments" | "catalogCohort"> = {
      assignments: [],
      catalogCohort: null,
    };
    try {
      if (who !== null && platform() !== "steam") {
        result = await fetchAssignments(who.auth);
      }
      // The cohort is a web-rail catalog thing: Steam never sends one.
      if (platform() === "steam") result = { ...result, catalogCohort: null };
    } catch {
      // Never rejects: anything unexpected is "no experiments".
      result = { assignments: [], catalogCohort: null };
    }
    const state: ExperimentsState = {
      generation: ++generation,
      account,
      assignments: result.assignments,
      catalogCohort: result.catalogCohort,
    };
    // Only the latest account's answer is published: one that lands after
    // a switch was made for a player who is no longer signed in.
    if (current === entry) publish(state);
    return state;
  })();
  return entry.promise;
}

/**
 * The player's groups once known, or null if they aren't within `ms`. A
 * catalog fetched on null goes out plain and untagged, and is refetched when
 * the groups land.
 */
export async function waitForExperiments(
  ms: number,
): Promise<ExperimentsState | null> {
  // The load this wait is for: null while waiting for the first publication.
  const waited = current;
  let waiter: ((state: ExperimentsState) => void) | null = null;
  let pending: Promise<ExperimentsState | null>;
  if (waited !== null) {
    // Never rejects into the catalog: a failed load is "not known".
    pending = waited.promise.catch(() => null);
  } else if (expected) {
    pending = new Promise((resolve) => {
      waiter = resolve;
      publishWaiters.add(resolve);
    });
  } else {
    return null;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  const state = await Promise.race([pending, timeout]).finally(() => {
    clearTimeout(timer);
    // A wait that timed out leaves nothing behind for a publication that
    // may never come.
    if (waiter !== null) publishWaiters.delete(waiter);
  });
  return freshest(state, waited);
}

/**
 * A state for the load now current, or null. A load superseded meanwhile (an
 * account switch, even one that came back to the same account) must not
 * choose the cohort: the latest published answer does, if it is for the
 * account now signed in. A wait for the first publication gets the same.
 */
function freshest(
  state: ExperimentsState | null,
  waited: typeof current,
): ExperimentsState | null {
  if (state === null || current === null) return state;
  if (waited === current) return state;
  return published !== null && published.account === current.account
    ? published
    : null;
}

/** The latest published groups, or null before the first load lands. */
export function experimentsState(): ExperimentsState | null {
  return published;
}

/** The player's group in a test, or null when not in it. */
export function experimentAssignment(key: string): ExperimentAssignment | null {
  return published?.assignments.find((a) => a.key === key) ?? null;
}

/** The catalog cohort to fetch cosmetics.json with, or null. */
export function catalogCohort(): string | null {
  return published?.catalogCohort ?? null;
}

/** Cosmetics.ts: the experiments generation of the catalog now in use. */
export function setCatalogGeneration(gen: number | null): void {
  catalogGeneration = gen;
  exposureWatcher.recheck();
}

/**
 * Whether the catalog on screen was fetched with the player's group known
 * (and is still that group's): only then may it send an exposure.
 */
export function assignmentKnown(): boolean {
  return (
    published !== null &&
    catalogGeneration !== null &&
    catalogGeneration === published.generation &&
    // Disarmed while another account's groups load (a direct switch).
    current !== null &&
    current.account === published.account
  );
}

// Per page load: one exposure per test per account is enough. The page and
// storage dedupe share one key: the account (JWT subject) the group is for.
const sentThisPage = new Set<string>();

function exposureKey(account: string, key: string): string {
  return `${EXPOSURE_STORAGE_PREFIX}${account}:${key}`;
}

function storedExposure(storageKey: string): boolean {
  try {
    return localStorage.getItem(storageKey) !== null;
  } catch {
    return false;
  }
}

function rememberExposure(storageKey: string): void {
  try {
    localStorage.setItem(storageKey, "1");
  } catch {
    // Storage blocked: the per-page dedupe and the server's still hold.
  }
}

/** The flash-deal tests that count this player, as the catalog shows them. */
function exposableAssignments(): ExperimentAssignment[] {
  if (!assignmentKnown() || platform() === "steam") return [];
  return (published?.assignments ?? []).filter(
    (a) => a.surface === FLASH_SALE_DEPTH && a.counted,
  );
}

/**
 * The player saw the tested deal in their group (the flash card in the store,
 * or the homepage deal banner). Sent once per test per page load, and not
 * again on later loads once the server took it. A failed POST is not
 * retried. Resolves to whether a request went out.
 */
export async function recordExposure(
  key: string,
  surface: ExperimentExposureSurface,
): Promise<boolean> {
  const assignment = exposableAssignments().find((a) => a.key === key);
  const account = published?.account ?? null;
  if (assignment === undefined || account === null) return false;
  const dedupeKey = exposureKey(account, key);
  if (sentThisPage.has(dedupeKey) || storedExposure(dedupeKey)) return false;
  const where = platform();
  if (where === "steam") return false;
  sentThisPage.add(dedupeKey);
  const body: ExperimentExposureBody = {
    platform: where,
    exposures: [{ key, variant: assignment.variant, surface }],
  };
  try {
    // Sent only with the token of the account the group was loaded for: an
    // account switch in between must not send A's group as B.
    const auth = await userAuth();
    if (auth === false || auth.claims.sub !== account) {
      sentThisPage.delete(dedupeKey);
      return false;
    }
    const response = await fetch(
      `${getApiBase()}/users/@me/experiments/exposures`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.jwt}`,
        },
        body: JSON.stringify(body),
      },
    );
    if (response.ok) rememberExposure(dedupeKey);
  } catch {
    // Not retried; the purchase-time exposure still catches buyers.
  }
  return true;
}

interface Watched {
  surface: ExperimentExposureSurface;
  // Whether the element shows the catalog now in use (see observe).
  shows: () => boolean;
  timer: ReturnType<typeof setTimeout> | null;
  visible: boolean;
}

/**
 * Exposures' own trigger, apart from store analytics: the flash card
 * (`[data-store-flash]`) or the homepage deal banner
 * (`[data-store-flash-banner]`) half visible for a full second. StoreTracker's
 * impression dedupe is untouched, so a catalog refetch never re-counts an
 * analytics impression; this watcher re-checks after every refetch instead,
 * so a card already on screen can send its exposure once the group is known.
 */
export class ExposureWatcher {
  private observer: IntersectionObserver | null = null;
  private readonly watched = new Map<Element, Watched>();
  private listening = false;

  /**
   * Watches `el` for `surface`. `shows` says whether it renders the catalog
   * now in use: a surface that swaps its catalog in late (the Store waits on
   * Play's prices in the Android app) would otherwise send an exposure for
   * the new group while still showing the old one's card. It's asked when
   * the timer arms and again when it fires; observing the same element again
   * (its next render) re-arms it once it does.
   */
  observe(
    el: Element,
    surface: ExperimentExposureSurface,
    shows: () => boolean = () => true,
  ): void {
    this.release();
    if (typeof IntersectionObserver === "undefined") return;
    const existing = this.watched.get(el);
    if (existing?.surface === surface) {
      existing.shows = shows;
      if (existing.visible && existing.timer === null) {
        this.startTimer(existing);
      }
      return;
    }
    this.listen();
    this.observer ??= new IntersectionObserver(
      (entries) => this.onEntries(entries),
      { threshold: EXPOSURE_RATIO },
    );
    this.watched.set(el, { surface, shows, timer: null, visible: false });
    this.observer.observe(el);
  }

  unobserve(el: Element): void {
    const w = this.watched.get(el);
    if (w === undefined) return;
    this.stopTimer(w);
    this.observer?.unobserve(el);
    this.watched.delete(el);
  }

  /** Stops watching everything (the observer is made afresh on next use). */
  dispose(): void {
    for (const w of this.watched.values()) this.stopTimer(w);
    this.watched.clear();
    this.observer?.disconnect();
    this.observer = null;
  }

  /** Re-arms every element already in view (after a refetch or a load). */
  recheck(): void {
    this.release();
    for (const w of this.watched.values()) {
      if (w.visible && w.timer === null) this.startTimer(w);
    }
  }

  private release(): void {
    for (const [el, w] of this.watched) {
      if (el.isConnected) continue;
      this.stopTimer(w);
      this.observer?.unobserve(el);
      this.watched.delete(el);
    }
  }

  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    document.addEventListener(COSMETICS_CHANGED, () => this.recheck());
    document.addEventListener("visibilitychange", () => {
      for (const w of this.watched.values()) {
        if (document.visibilityState === "hidden") this.stopTimer(w);
        else if (w.visible) this.startTimer(w);
      }
    });
  }

  private onEntries(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      const w = this.watched.get(entry.target);
      if (w === undefined) continue;
      this.stopTimer(w);
      w.visible =
        entry.isIntersecting && entry.intersectionRatio >= EXPOSURE_RATIO;
      if (w.visible) this.startTimer(w);
    }
  }

  private startTimer(w: Watched): void {
    this.stopTimer(w);
    // Disarmed until the catalog on screen was fetched with the group known.
    if (document.visibilityState === "hidden") return;
    if (exposableAssignments().length === 0) return;
    if (!w.shows()) return;
    w.timer = setTimeout(() => {
      w.timer = null;
      if (!w.shows()) return;
      for (const a of exposableAssignments()) {
        void recordExposure(a.key, w.surface);
      }
    }, EXPOSURE_MS);
  }

  private stopTimer(w: Watched): void {
    if (w.timer === null) return;
    clearTimeout(w.timer);
    w.timer = null;
  }
}

export const exposureWatcher = new ExposureWatcher();

// An account change (sign-in, switch, logout) reloads the groups for the new
// account; the same account answers from the memo with no request.
document.addEventListener("userMeResponse", () => {
  if (current === null) return;
  void loadExperiments().catch(() => undefined);
});

/** Tests only. */
export function resetExperimentsForTest(): void {
  generation = 0;
  current = null;
  published = null;
  expected = false;
  catalogGeneration = null;
  publishWaiters.clear();
  sentThisPage.clear();
  exposureWatcher.dispose();
}

/** Tests only: publish groups as if loaded, and tag the catalog with them. */
export function publishExperimentsForTest(
  assignments: ExperimentAssignment[],
  cohort: string | null = null,
  account: string | null = "test-account",
): ExperimentsState {
  const state: ExperimentsState = {
    generation: ++generation,
    account,
    assignments,
    catalogCohort: cohort,
  };
  current = { account, promise: Promise.resolve(state) };
  publish(state);
  setCatalogGeneration(state.generation);
  return state;
}

/** Tests only: how many catalog waits are registered for a publication. */
export function publishWaitersForTest(): number {
  return publishWaiters.size;
}

/** Tests only: a load in flight for `account`, settling with `promise`. */
export function loadInFlightForTest(
  account: string | null,
  promise: Promise<ExperimentsState>,
): void {
  current = { account, promise };
}
