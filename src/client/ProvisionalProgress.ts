import type {
  GameXpResponse,
  Progress,
  ProgressionConfig,
  UserMeResponse,
} from "@openfront/shared/ApiSchemas";
import { z } from "zod";
import type { GameXpFetchResult } from "./ProgressionApi";
import { projectProgress } from "./ProgressProjection";

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
  // whether it took the first-public-game-of-the-day bonus.
  day: z.string().optional(),
  kind: z.enum(["public", "private", "singleplayer"]).optional(),
  firstGame: z.boolean().optional(),
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
    const { total, firstGame } = response.breakdown;
    return [
      ...rest,
      {
        ...about,
        firstGame: firstGame > 0,
        gameId: response.gameId,
        xp: total,
        at: now,
        ...kept,
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
  const counted: PendingXp[] = [];
  let uncertain = false;
  for (const e of entries) {
    if (e.scored !== undefined) {
      if (lifetime < e.scored.lifetimeAfter) counted.push(e);
    } else if (
      e.notIn !== undefined &&
      (lifetime <= e.notIn || lifetime - e.notIn === scoredBetween(e.notIn))
    ) {
      counted.push(e);
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
      daily.firstGameClaimed || today.some((e) => e.firstGame === true),
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

/** The games a PROVISIONAL_PROGRESS_CHANGED event says were just scored. */
export function scoredGames(event: Event): readonly string[] {
  return (
    (event as CustomEvent<{ scored: string[] } | null>).detail?.scored ?? []
  );
}

export interface ProvisionalView<P> {
  // The progress to show: with the pending games' XP when any count, else
  // the figure itself.
  progress: P;
  // Counts XP from games the API hasn't scored yet.
  provisional: boolean;
  // The figure's own level: its rewards list knows nothing past it.
  confirmedLevel: number;
}

export interface ProvisionalDeps {
  // GET /users/@me/xp/:gameId.
  fetchXp: (gameId: string) => Promise<GameXpFetchResult>;
  // GET /public/progression/config.
  loadConfig: () => Promise<ProgressionConfig | false>;
  // Reads /users/@me afresh (false when it can't); the store broadcasts it.
  readUserMe: () => Promise<UserMeResponse | false>;
  now?: () => number;
  // How often to ask while games are unscored, and how many times per page.
  pollMs?: number;
  maxPolls?: number;
}

const TAB = Math.random().toString(36).slice(2);
let deps: ProvisionalDeps | null = null;
let account: string | null = null;
let config: ProgressionConfig | null = null;
// The highest lifetime XP of the account's /users/@me figures so far.
let seenLifetime: number | null = null;
let inFlight: Promise<void> | null = null;
let again = false;
// While this store broadcasts the account it read: that asks nothing more.
let broadcasting = false;
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

/** Whether this publicId is the signed-in account the store follows. */
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
    confirmedLevel: confirmed.level,
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
          confirmedLevel: confirmed.level,
        };
  views.set(confirmed, { key, view });
  return view;
}

function emitChanged(scored: string[] = []): void {
  document.dispatchEvent(
    new CustomEvent(PROVISIONAL_PROGRESS_CHANGED, { detail: { scored } }),
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
    again = true;
    return inFlight;
  }
  const entries = readPendingXp(forAccount, now());
  const settled = figure ? pendingXpFor(figure, entries).counted : [];
  const asking = entries.filter((e) => !e.scored && !settled.includes(e));
  if (asking.length === 0) return Promise.resolve(syncPolling());
  writeJson(PENDING_XP_CHECKED_KEY, { [forAccount]: { at: now(), tab: TAB } });
  const seen = seenLifetime;
  const live = () => deps === d && account === forAccount;
  inFlight = (async () => {
    const scored: string[] = [];
    for (const entry of asking) {
      const answer = await d
        .fetchXp(entry.gameId)
        .catch((): GameXpFetchResult => ({ status: "pending" }));
      if (!live()) return;
      if (answer.status === "ok") {
        applyGameXp(forAccount, answer.data, {}, now());
        if (answer.data.eligible) scored.push(entry.gameId);
      } else if (answer.status === "pending" && answer.rateLimited) {
        backoffUntil = now() + pollMs();
        again = false;
        break;
      } else if (answer.status === "pending" && answer.notFound) {
        if (seen !== null) raiseNotIn(forAccount, entry.gameId, seen, now());
      }
    }
    if (scored.length > 0) {
      const fresh = await d.readUserMe().catch(() => false as const);
      if (!live()) return;
      if (fresh !== false && fresh.player.publicId === forAccount) {
        broadcasting = true;
        try {
          document.dispatchEvent(
            new CustomEvent("userMeResponse", { detail: fresh }),
          );
        } finally {
          broadcasting = false;
        }
      }
    }
    emitChanged(scored);
    syncPolling();
  })().finally(() => {
    inFlight = null;
    if (again) {
      again = false;
      void runCheck();
    }
  });
  return inFlight;
}

// Polls while the account has unscored games, up to the cap.
function syncPolling(): void {
  const want =
    account !== null &&
    polls < (deps?.maxPolls ?? 120) &&
    readPendingXp(account, now()).some((e) => !e.scored);
  if (want && timer === null) timer = setInterval(poll, pollMs());
  if (!want && timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function poll(): void {
  if (account === null || document.visibilityState !== "visible") return;
  // Another tab asked within the interval: its answers come through storage.
  const last = readJson(PENDING_XP_CHECKED_KEY, CheckedSchema, {})[account];
  if (last && last.tab !== TAB && now() - last.at < pollMs()) return;
  polls++;
  void runCheck();
  syncPolling();
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
  if (!broadcasting && pendingXpFor(progress, entries).uncertain) {
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
  const onVisible = () => timer !== null && poll();
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
  again = false;
  backoffUntil = 0;
  polls = 0;
  cached = null;
}
