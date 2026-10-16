import type {
  GameXpResponse,
  Progress,
  ProgressionConfig,
  UserMeResponse,
} from "@openfront/shared/ApiSchemas";
import { z } from "zod";
import type { GameXpFetchResult } from "./ProgressionApi";
import { projectProgress } from "./ProgressProjection";
import { applyMultipliers } from "./XpMultipliers";

// The player's own level with the XP of games the API hasn't scored yet.
//
// A player who dies before the game ends sees a provisional XP figure
// (ProvisionalXpAtDeath.ts), but the API only scores a game once the whole
// match ends. The figure is kept here, per account, and added onto the
// player's own level wherever it shows, marked provisional, until the API has
// scored the game. Local and display only; with no config, the confirmed
// figures show.
//
// What a figure of the player's progress already includes is decided by its
// lifetimeXp, which only grows as games are scored:
// - A scored game keeps its entry (`scored`), so a figure below its
//   `lifetimeAfter` (a stale read) still shows it, as confirmed XP.
// - An unscored game counts onto a figure at or below its `notIn` (the
//   highest lifetime of a figure read before the API said 404), or above it
//   by exactly the XP of games this browser knows were scored since. Only an
//   unexplained rise (a game on another device) leaves it uncounted until a
//   check answers.

// ------------------------------------------------------------------ storage

export const PENDING_XP_KEY = "provisionalXp";
// When a tab last asked the API, per account: the other tabs skip a poll.
export const PENDING_XP_CHECKED_KEY = "provisionalXpCheckedAt";
export const PENDING_XP_TTL_MS = 12 * 60 * 60 * 1000;
// More than this many games and the oldest go, scored ones first.
export const MAX_PENDING_PER_ACCOUNT = 20;

const PendingXpSchema = z.object({
  gameId: z.string(),
  // The provisional XP figure for the game.
  xp: z.number(),
  // When it was stored (epoch ms).
  at: z.number(),
  // For the day's allowances: the API's UTC day stamp, the kind of game, and
  // the XP the first-public-game-of-the-day bonus added to it (the API's,
  // once scored).
  day: z.string().optional(),
  kind: z.enum(["public", "private", "singleplayer"]).optional(),
  firstGame: z.number().optional(),
  // Unscored: the highest lifetime XP of a figure known not to include it.
  notIn: z.number().optional(),
  // Scored: the XP the API gave it, and the lifetime XP that took the
  // player to.
  scored: z.object({ xp: z.number(), lifetimeAfter: z.number() }).optional(),
});
const StoreSchema = z.record(z.string(), z.array(PendingXpSchema));
const CheckedSchema = z.record(
  z.string(),
  z.object({ at: z.number(), tab: z.string() }),
);

export type PendingXp = z.infer<typeof PendingXpSchema>;
export type PendingGameKind = NonNullable<PendingXp["kind"]>;
type Store = z.infer<typeof StoreSchema>;

// Exactly as the API rounds: the total less the total without it.
export function firstGameXp(b: {
  firstGame: number;
  subtotal: number;
  gamePermille: number;
  subscriberPermille: number;
}): number {
  const award = (subtotal: number) =>
    applyMultipliers(subtotal, b.gamePermille, b.subscriberPermille);
  return award(b.subtotal) - award(b.subtotal - b.firstGame);
}

// The parsed store, dropped on every write and on the storage event.
let cached: Store | null = null;

function readJson<T>(key: string, schema: z.ZodType<T>, empty: T): T {
  try {
    const parsed = schema.safeParse(
      JSON.parse(localStorage.getItem(key) ?? "null"),
    );
    return parsed.success ? parsed.data : empty;
  } catch {
    return empty;
  }
}

function writeJson(key: string, value: object): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Full or blocked storage: nothing is carried over.
  }
}

function loadStore(): Store {
  cached ??= readJson(PENDING_XP_KEY, StoreSchema, {});
  return cached;
}

/** The account's pending games, expired ones left out. */
export function readPendingXp(
  publicId: string,
  now: number = Date.now(),
): PendingXp[] {
  const store = loadStore();
  const list = Object.prototype.hasOwnProperty.call(store, publicId)
    ? store[publicId]
    : [];
  // Either way: a clock set back mustn't keep an entry forever.
  return list.filter((e) => Math.abs(now - e.at) < PENDING_XP_TTL_MS);
}

function updateList(
  publicId: string,
  now: number,
  change: (list: PendingXp[]) => PendingXp[],
): void {
  if (!publicId) return;
  const store: Store = {};
  for (const id of Object.keys(loadStore())) {
    const live = readPendingXp(id, now);
    if (live.length > 0) store[id] = live;
  }
  const list = change(store[publicId] ?? []);
  if (list.length > 0) store[publicId] = list;
  else delete store[publicId];
  cached = store;
  writeJson(PENDING_XP_KEY, store);
}

/**
 * Keeps a game's provisional XP for the account until the API scores it.
 * `notIn` is the lifetime XP of the account the figure was worked out from,
 * read before the game ended.
 */
export function recordPendingXp(
  publicId: string,
  entry: Omit<PendingXp, "at" | "scored">,
  now: number = Date.now(),
): void {
  if (!(entry.xp > 0)) return;
  updateList(publicId, now, (current) => {
    const list = current.filter((e) => e.gameId !== entry.gameId);
    list.push({ ...entry, xp: Math.floor(entry.xp), at: now });
    while (list.length > MAX_PENDING_PER_ACCOUNT) {
      const scored = list.findIndex((e) => e.scored !== undefined);
      list.splice(Math.max(scored, 0), 1);
    }
    return list;
  });
}

/**
 * The API's answer for a game. Eligible: marked scored, and added when it
 * isn't kept yet (a game played to the end), so stale figures still show it
 * and other pending games still count on top of it. Ineligible: dropped.
 */
export function applyGameXp(
  publicId: string,
  response: GameXpResponse,
  about: Pick<PendingXp, "day" | "kind"> = {},
  now: number = Date.now(),
): void {
  updateList(publicId, now, (list) => {
    const rest = list.filter((e) => e.gameId !== response.gameId);
    if (!response.eligible) return rest;
    const kept = list.find((e) => e.gameId === response.gameId);
    const { total } = response.breakdown;
    return [
      ...rest,
      {
        ...about,
        ...kept,
        gameId: response.gameId,
        xp: total,
        at: now,
        firstGame: firstGameXp(response.breakdown),
        scored: { xp: total, lifetimeAfter: response.after.lifetimeXp },
      },
    ];
  });
}

function raiseNotIn(
  publicId: string,
  gameId: string,
  lifetime: number,
  now: number,
) {
  updateList(publicId, now, (list) =>
    list.map((e) =>
      e.gameId === gameId && e.scored === undefined
        ? { ...e, notIn: Math.max(e.notIn ?? 0, lifetime) }
        : e,
    ),
  );
}

// --------------------------------------------------------------- projection

/** The level fields every source of the player's progress has. */
export interface ProgressLike {
  prestige: number;
  level: number;
  lifetimeXp: number;
  legend: boolean;
  // Missing from an older public endpoint: then there's no projection.
  xpInLevel?: number;
  xpForNext?: number;
  canPrestige?: boolean;
}

/**
 * Where `xp` would take the progress on the level curve, or null when there
 * is nothing to project (no XP, the end of the run, no place in the level, a
 * curve that doesn't cover it). Provisional XP never prestiges and never
 * makes a Legend; the API's own (scored) XP does, as the API would.
 */
export function projectPendingXp(
  confirmed: ProgressLike,
  xp: number,
  config: ProgressionConfig,
  provisional = true,
): Progress | null {
  const { xpInLevel, xpForNext } = confirmed;
  if (!(xp > 0) || confirmed.legend || confirmed.canPrestige === true) {
    return null;
  }
  if (xpInLevel === undefined || xpForNext === undefined) return null;
  if (confirmed.level >= config.maxLevel) return null;
  const projected = projectProgress(
    { ...confirmed, xpInLevel, xpForNext, canPrestige: false },
    xp,
    config,
  );
  if (projected === null) return null;
  return provisional
    ? { ...projected.after, legend: false, canPrestige: false }
    : projected.after;
}

const xpOf = (e: PendingXp) => e.scored?.xp ?? e.xp;
const sumXp = (list: readonly PendingXp[]) =>
  list.reduce((sum, e) => sum + xpOf(e), 0);

/**
 * The entries to add onto a figure with this lifetime XP: the scored games it
 * doesn't include yet, and the unscored ones known not to be in it.
 * `uncertain`: an unscored game is left out until a check answers.
 */
export function pendingXpFor(
  figure: { lifetimeXp: number },
  entries: readonly PendingXp[],
): { counted: PendingXp[]; uncertain: boolean } {
  const lifetime = figure.lifetimeXp;
  // The XP of games known scored between two lifetimes.
  const scoredBetween = (from: number) =>
    entries.reduce((sum, e) => {
      const after = e.scored?.lifetimeAfter ?? -1;
      return after > from && after <= lifetime ? sum + e.scored!.xp : sum;
    }, 0);
  // The API gives the day's first-game bonus to whichever game it scores
  // first: once a scored game has it, a pending game's provisional bonus
  // that day won't be paid.
  // Only games this browser kept are seen (not one scored on another
  // device): accepted, as either way it clears once the game is scored.
  const bonusTaken = (e: PendingXp) =>
    entries.some((o) => o.scored && o.day === e.day && (o.firstGame ?? 0) > 0);
  const counted: PendingXp[] = [];
  let uncertain = false;
  for (const e of entries) {
    if (e.scored !== undefined) {
      if (lifetime < e.scored.lifetimeAfter) counted.push(e);
    } else if (
      e.notIn !== undefined &&
      (lifetime <= e.notIn || lifetime - e.notIn === scoredBetween(e.notIn))
    ) {
      counted.push(
        e.day !== undefined && (e.firstGame ?? 0) > 0 && bonusTaken(e)
          ? { ...e, xp: e.xp - e.firstGame!, firstGame: 0 }
          : e,
      );
    } else {
      uncertain = true;
    }
  }
  return { counted, uncertain };
}

/**
 * The progress with pending games stacked on top, for the next game's
 * provisional figure at death: where their XP takes it, and the day's
 * allowances they used (games stamped with the API's same UTC day only).
 * Pass only the games the figure doesn't include (pendingXpFor).
 */
export function stackPendingXp(
  progress: Progress,
  pending: readonly PendingXp[],
  config: ProgressionConfig,
): Progress {
  const projected = projectPendingXp(progress, sumXp(pending), config);
  const stacked: Progress = { ...progress, ...projected };
  const daily = progress.daily;
  if (pending.length === 0 || daily?.day === undefined) return stacked;
  const today = pending.filter((e) => e.day === daily.day);
  stacked.daily = {
    ...daily,
    privateGames:
      daily.privateGames + today.filter((e) => e.kind === "private").length,
    singleplayerGames:
      daily.singleplayerGames +
      today.filter((e) => e.kind === "singleplayer").length,
    firstGameClaimed:
      daily.firstGameClaimed || today.some((e) => (e.firstGame ?? 0) > 0),
  };
  return stacked;
}

/**
 * The account's other pending games stacked onto `progress`, for the
 * provisional figure at death. Asks nothing: the stored answers decide.
 */
export function withPendingXp(
  publicId: string,
  progress: Progress,
  config: ProgressionConfig,
  excludeGameId: string,
): Progress {
  const others = readPendingXp(publicId).filter(
    (e) => e.gameId !== excludeGameId,
  );
  return stackPendingXp(
    progress,
    pendingXpFor(progress, others).counted,
    config,
  );
}

// ----------------------------------------------------------------- display

/** Sent on document whenever what provisionalProgress() returns may change. */
export const PROVISIONAL_PROGRESS_CHANGED = "provisional-progress-changed";

interface ProvisionalChange {
  // Games just scored, and the lifetime XP the highest took the player to.
  scored: string[];
  scoredUpTo: number;
}
const changeOf = (event: Event): Partial<ProvisionalChange> =>
  (event as CustomEvent<ProvisionalChange | null>).detail ?? {};

export function scoredGames(event: Event): readonly string[] {
  return changeOf(event).scored ?? [];
}

export function scoredUpTo(event: Event): number {
  return changeOf(event).scoredUpTo ?? 0;
}

export interface ProvisionalView<P> {
  // The progress to show: with the pending games' XP when any count, else
  // the figure itself.
  progress: P;
  // Counts XP from games the API hasn't scored yet.
  provisional: boolean;
  // Null when nothing is added. Else the level with the scored XP: past it,
  // levels are reached only provisionally. (The reward track also caps it at
  // the level of the /users/@me copy its rewards came from.)
  confirmedLevel: number | null;
}

export interface ProvisionalDeps {
  // GET /users/@me/xp/:gameId.
  fetchXp: (gameId: string) => Promise<GameXpFetchResult>;
  // GET /public/progression/config.
  loadConfig: () => Promise<ProgressionConfig | false>;
  // Reads /users/@me afresh and broadcasts it (broadcastFreshUserMe).
  refreshUserMe: () => Promise<unknown>;
  now?: () => number;
  // How often to ask while games are unscored, and how many times per page.
  pollMs?: number;
  maxPolls?: number;
}

const TAB = Math.random().toString(36).slice(2);
let deps: ProvisionalDeps | null = null;
let account: string | null = null;
let config: ProgressionConfig | null = null;
// The highest lifetime XP of the account's figures shown so far.
let seenLifetime: number | null = null;
let inFlight: Promise<void> | null = null;
// A check asked for while one ran: the figure it was for (the newest), or
// null for every unscored game.
let again: { lifetimeXp: number } | null | undefined;
// When this tab last started a check.
let lastCheck = -Infinity;
// After a 429, no request before this.
let backoffUntil = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let polls = 0;
let removeListeners: (() => void) | null = null;
// The projected view per figure, so its identity holds while nothing
// changes (the account menu animates on a new one).
const views = new WeakMap<object, { key: string; view: object }>();

const now = () => deps?.now?.() ?? Date.now();
const pollMs = () => deps?.pollMs ?? 60_000;

export function isOwnAccount(publicId: string | null | undefined): boolean {
  return deps !== null && !!publicId && publicId === account;
}

/**
 * The player's own progress as it should show: with the XP of games the
 * figure doesn't include yet. Scored games' XP is confirmed; unscored games'
 * makes it provisional. Anyone else's progress is returned unchanged. Pure:
 * reads the cached store, starts nothing.
 */
export function provisionalProgress<P extends ProgressLike>(
  publicId: string | null | undefined,
  confirmed: P,
): ProvisionalView<P> {
  const plain = {
    progress: confirmed,
    provisional: false,
    confirmedLevel: null,
  };
  if (!isOwnAccount(publicId) || config === null) return plain;
  const { counted } = pendingXpFor(confirmed, readPendingXp(account!, now()));
  const scoredXp = sumXp(counted.filter((e) => e.scored !== undefined));
  const unscoredXp = sumXp(counted) - scoredXp;
  const key = `${scoredXp}:${unscoredXp}:${config.version}`;
  const memo = views.get(confirmed);
  if (memo?.key === key) return memo.view as ProvisionalView<P>;
  const base =
    projectPendingXp(confirmed, scoredXp, config, false) ?? confirmed;
  const top = projectPendingXp(base, unscoredXp, config);
  const view =
    base === confirmed && top === null
      ? plain
      : {
          progress: { ...confirmed, ...base, ...top },
          provisional: top !== null,
          confirmedLevel: base.level,
        };
  views.set(confirmed, { key, view });
  return view;
}

function emitChanged(scored: string[] = [], upTo = 0): void {
  const detail: ProvisionalChange = { scored, scoredUpTo: upTo };
  document.dispatchEvent(
    new CustomEvent(PROVISIONAL_PROGRESS_CHANGED, { detail }),
  );
}

/**
 * The one path that asks GET /users/@me/xp/:gameId: one unscored game at a
 * time (only those `figure` leaves uncertain, when given), stopping and
 * backing off a poll interval at a 429. A scored game is
 * marked; then /users/@me is read afresh and broadcast, so the rewards list
 * catches up (nothing else depends on it).
 */
export function runCheck(figure?: { lifetimeXp: number }): Promise<void> {
  const d = deps;
  const forAccount = account;
  if (d === null || forAccount === null || now() < backoffUntil) {
    return Promise.resolve();
  }
  if (inFlight !== null) {
    // The newest figure: its uncertain games include the older ones', and
    // the 404s raise notIn past all of them.
    again =
      again === null || !figure
        ? null
        : !again || figure.lifetimeXp > again.lifetimeXp
          ? figure
          : again;
    return inFlight;
  }
  const entries = readPendingXp(forAccount, now());
  const settled = figure ? pendingXpFor(figure, entries).counted : [];
  const asking = entries.filter((e) => !e.scored && !settled.includes(e));
  if (asking.length === 0) return Promise.resolve(syncPolling());
  lastCheck = now();
  writeJson(PENDING_XP_CHECKED_KEY, { [forAccount]: { at: now(), tab: TAB } });
  const seen = seenLifetime;
  const live = () => deps === d && account === forAccount;
  inFlight = (async () => {
    const scored: string[] = [];
    let upTo = 0;
    for (const entry of asking) {
      const answer = await d
        .fetchXp(entry.gameId)
        .catch((): GameXpFetchResult => ({ status: "pending" }));
      if (!live()) return;
      if (answer.status === "ok") {
        applyGameXp(forAccount, answer.data, {}, now());
        if (answer.data.eligible) {
          scored.push(entry.gameId);
          upTo = Math.max(upTo, answer.data.after.lifetimeXp);
        }
      } else if (answer.status === "pending" && answer.rateLimited) {
        backoffUntil = now() + pollMs();
        again = undefined;
        break;
      } else if (answer.status === "pending" && answer.notFound) {
        if (seen !== null) raiseNotIn(forAccount, entry.gameId, seen, now());
      }
    }
    // Its broadcast includes the games just scored, so it asks nothing more
    // unless it shows a rise they don't explain (and never within a 429's
    // back-off).
    if (scored.length > 0) {
      await d.refreshUserMe().catch(() => undefined);
      if (!live()) return;
    }
    emitChanged(scored, upTo);
    syncPolling();
  })().finally(() => {
    inFlight = null;
    const queued = again;
    again = undefined;
    if (queued !== undefined) void runCheck(queued ?? undefined);
  });
  return inFlight;
}

// Polls while the account has unscored games, up to the cap.
function syncPolling(): void {
  const want =
    account !== null &&
    polls < (deps?.maxPolls ?? 120) &&
    readPendingXp(account, now()).some((e) => !e.scored);
  if (want && timer === null) timer = setInterval(() => poll(true), pollMs());
  if (!want && timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

// Whether this tab, or another (whose answers come through storage), asked
// within the poll interval.
function checkedRecently(): boolean {
  if (now() - lastCheck < pollMs()) return true;
  const last = readJson(PENDING_XP_CHECKED_KEY, CheckedSchema, {})[account!];
  return !!last && last.tab !== TAB && now() - last.at < pollMs();
}

// `timed`: the interval's tick, which counts towards the cap; a return to
// the page doesn't, so tab switches can't use the polls up.
function poll(timed: boolean): void {
  if (account === null || document.visibilityState !== "visible") return;
  if (checkedRecently()) return;
  if (timed) polls++;
  void runCheck();
  syncPolling();
}

/**
 * A figure of the player's own progress a view read itself (the public
 * progress, for the Progression tab and the profile): when the stored
 * answers can't settle it, a check asks, and its 404s lift the games' notIn
 * past it, so every view shows the same level after one check.
 */
export function noteFigure(
  publicId: string | null | undefined,
  figure: { lifetimeXp: number },
): void {
  if (!isOwnAccount(publicId)) return;
  seenLifetime = Math.max(seenLifetime ?? 0, figure.lifetimeXp);
  const entries = readPendingXp(account!, now());
  if (pendingXpFor(figure, entries).uncertain && !checkedRecently()) {
    void runCheck(figure);
  }
}

function onUserMe(event: Event): void {
  const me = (event as CustomEvent<UserMeResponse | false>).detail;
  const next = me === false ? null : (me?.player?.publicId ?? null);
  if (next !== account) {
    account = next;
    seenLifetime = null;
    polls = 0;
    emitChanged();
  }
  const progress = me === false ? undefined : me?.player?.progress;
  if (account === null || progress === undefined) return syncPolling();
  seenLifetime = Math.max(seenLifetime ?? 0, progress.lifetimeXp);
  if (config === null) {
    const d = deps;
    void d
      ?.loadConfig()
      .catch(() => false as const)
      .then((loaded) => {
        if (deps !== d || loaded === false) return;
        config = loaded;
        emitChanged();
      });
  }
  // A figure the stored answers can't settle is asked about now.
  const entries = readPendingXp(account, now());
  if (pendingXpFor(progress, entries).uncertain) {
    void runCheck(progress);
  } else {
    syncPolling();
  }
}

/**
 * Starts following the signed-in account (its userMeResponse broadcasts) and
 * checking its unscored games. Main calls this before the first broadcast.
 */
export function startProvisionalProgress(d: ProvisionalDeps): () => void {
  stopProvisionalProgress();
  deps = d;
  const onSessionCleared = () => {
    account = null;
    syncPolling();
    emitChanged();
  };
  const onVisible = () => poll(false);
  // Another tab changed the pending games: show it, nothing more.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== PENDING_XP_KEY && event.key !== null) return;
    cached = null;
    emitChanged();
    syncPolling();
  };
  document.addEventListener("userMeResponse", onUserMe);
  document.addEventListener("session-cleared", onSessionCleared);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("storage", onStorage);
  removeListeners = () => {
    document.removeEventListener("userMeResponse", onUserMe);
    document.removeEventListener("session-cleared", onSessionCleared);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("storage", onStorage);
  };
  return stopProvisionalProgress;
}

export function stopProvisionalProgress(): void {
  removeListeners?.();
  removeListeners = null;
  if (timer !== null) clearInterval(timer);
  timer = null;
  deps = null;
  account = null;
  config = null;
  seenLifetime = null;
  inFlight = null;
  again = undefined;
  lastCheck = -Infinity;
  backoffUntil = 0;
  polls = 0;
  cached = null;
}
