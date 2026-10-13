import type {
  Progress,
  ProgressionConfig,
  UserMeResponse,
} from "@openfront/shared/ApiSchemas";
import type { GameXpFetchResult } from "./ProgressionApi";
import { projectProgress } from "./ProgressProjection";

// The player's own level with the XP of games still waiting to be scored.
//
// A player who dies before the game ends sees a provisional XP figure
// (ProvisionalXpAtDeath.ts), but the API only scores the game once the whole
// match ends. Until then the account menu, the Account modal and the profile
// would show the old level. So the figure is kept here, per account, and
// projected onto the confirmed progress everywhere the player's own level
// shows, marked as provisional, until the API has scored the game.
//
// Local and display only: it is never sent anywhere, other players never see
// it, and it fails closed (no config, an API that predates any of this, a
// failed check: the confirmed figures show).
//
// No double counting: a pending game's XP is only added onto a confirmed
// figure that was read BEFORE the API last said (404) it hadn't scored that
// game. A figure read since then may already include it, so it shows as it
// is until the next check.

// ------------------------------------------------------------------ storage

export const PENDING_XP_KEY = "provisionalXp";
// A game is long scored by then; past it an entry is dropped unasked.
export const PENDING_XP_TTL_MS = 24 * 60 * 60 * 1000;
// More than this many unscored games and the oldest go.
export const MAX_PENDING_PER_ACCOUNT = 20;

// What kind of game it was, for the per-day allowances: private and
// singleplayer games count towards their own daily caps.
export type PendingGameKind = "public" | "private" | "singleplayer";

export interface PendingXp {
  gameId: string;
  // The provisional XP figure for the game.
  xp: number;
  // When it was stored (epoch ms).
  at: number;
  // For the next game's provisional figure, so a second game in a row doesn't
  // count the day's allowances twice. All three are missing from entries
  // stored before they were kept (see stackPendingXp).
  // The UTC day the API stamped the daily allowances with ("YYYY-MM-DD").
  day?: string;
  kind?: PendingGameKind;
  // Its figure took the first-public-game-of-the-day bonus.
  firstGame?: boolean;
}

export interface PendingXpInput {
  gameId: string;
  xp: number;
  day?: string | null;
  kind?: PendingGameKind | null;
  firstGame?: boolean;
}

// By account (publicId), so another account on the same browser never sees
// it.
type PendingStore = Record<string, PendingXp[]>;

const KINDS: ReadonlySet<string> = new Set([
  "public",
  "private",
  "singleplayer",
]);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// The entry as stored, or null when it doesn't read as one. An optional field
// that doesn't read is dropped, not the entry.
function readEntry(value: unknown): PendingXp | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.gameId !== "string" ||
    v.gameId.length === 0 ||
    typeof v.xp !== "number" ||
    !Number.isFinite(v.xp) ||
    v.xp <= 0 ||
    typeof v.at !== "number" ||
    !Number.isFinite(v.at)
  ) {
    return null;
  }
  const entry: PendingXp = { gameId: v.gameId, xp: v.xp, at: v.at };
  if (typeof v.day === "string" && DAY.test(v.day)) entry.day = v.day;
  if (typeof v.kind === "string" && KINDS.has(v.kind)) {
    entry.kind = v.kind as PendingGameKind;
  }
  if (typeof v.firstGame === "boolean") entry.firstGame = v.firstGame;
  return entry;
}

function isLive(entry: PendingXp, now: number): boolean {
  // Either way: a clock set back a day mustn't keep an entry forever.
  return Math.abs(now - entry.at) < PENDING_XP_TTL_MS;
}

function readStore(now: number): PendingStore {
  const out: PendingStore = {};
  try {
    const raw = localStorage.getItem(PENDING_XP_KEY);
    if (raw === null) return out;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return out;
    for (const [publicId, list] of Object.entries(parsed)) {
      if (!Array.isArray(list)) continue;
      const live = list
        .map(readEntry)
        .filter((e): e is PendingXp => e !== null && isLive(e, now));
      if (live.length > 0) out[publicId] = live;
    }
  } catch {
    // Unreadable or blocked storage: nothing pending.
  }
  return out;
}

function writeStore(store: PendingStore): void {
  try {
    if (Object.keys(store).length === 0) {
      localStorage.removeItem(PENDING_XP_KEY);
    } else {
      localStorage.setItem(PENDING_XP_KEY, JSON.stringify(store));
    }
  } catch {
    // Full or blocked storage: the figure just isn't carried over.
  }
}

function listFor(store: PendingStore, publicId: string): PendingXp[] {
  return Object.prototype.hasOwnProperty.call(store, publicId)
    ? store[publicId]
    : [];
}

/** The account's games still waiting to be scored, expired ones left out. */
export function readPendingXp(
  publicId: string,
  now: number = Date.now(),
): PendingXp[] {
  if (!publicId) return [];
  return listFor(readStore(now), publicId);
}

/**
 * Keeps a game's provisional XP for the account until the API scores it.
 * A second figure for the same game replaces the first.
 */
export function recordPendingXp(
  publicId: string,
  entry: PendingXpInput,
  now: number = Date.now(),
): void {
  const pending = readEntry({
    gameId: entry.gameId,
    xp: Math.floor(entry.xp),
    at: now,
    day: entry.day ?? undefined,
    kind: entry.kind ?? undefined,
    firstGame: entry.firstGame,
  });
  if (!publicId || pending === null) return;
  // Written back pruned: expired entries, any account's, go.
  const store = readStore(now);
  const list = listFor(store, publicId).filter(
    (e) => e.gameId !== entry.gameId,
  );
  list.push(pending);
  store[publicId] = list.slice(-MAX_PENDING_PER_ACCOUNT);
  writeStore(store);
}

/** Drops the account's entries for these games. */
export function clearPendingXp(
  publicId: string,
  gameIds: Iterable<string>,
  now: number = Date.now(),
): void {
  const drop = new Set(gameIds);
  if (!publicId || drop.size === 0) return;
  const store = readStore(now);
  const list = listFor(store, publicId).filter((e) => !drop.has(e.gameId));
  if (list.length > 0) store[publicId] = list;
  else delete store[publicId];
  writeStore(store);
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
 * Where `xp` pending XP would take the confirmed progress: the level curve
 * from the config, as the API would apply it. Null when there is nothing to
 * project, or it can't be: no XP, a player at the end of the run (level 100,
 * waiting to prestige, or a Legend: the API doesn't accrue there), a progress
 * without its place in the level, or a config that doesn't cover the levels.
 *
 * It never prestiges and never makes a Legend: past the last level the
 * projection stops at it, with no Prestige offered until the API confirms.
 */
export function projectPendingXp(
  confirmed: ProgressLike,
  xp: number,
  config: ProgressionConfig,
): Progress | null {
  if (!(xp > 0) || !Number.isFinite(xp)) return null;
  if (confirmed.legend || confirmed.canPrestige === true) return null;
  const { xpInLevel, xpForNext } = confirmed;
  if (xpInLevel === undefined || xpForNext === undefined) return null;
  if (!(config.maxLevel > 1) || confirmed.level >= config.maxLevel) {
    return null;
  }
  const projected = projectProgress(
    {
      prestige: confirmed.prestige,
      level: confirmed.level,
      xpInLevel,
      xpForNext,
      lifetimeXp: confirmed.lifetimeXp,
      legend: false,
      canPrestige: false,
    },
    xp,
    config,
  );
  if (projected === null) return null;
  return { ...projected.after, legend: false, canPrestige: false };
}

// ------------------------------------------------------------------ stacking

// The UTC day an epoch time falls on ("YYYY-MM-DD").
function utcDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/**
 * The confirmed progress with pending games stacked on top, for the next
 * game's provisional figure at death: the place on the level track their XP
 * takes it to (as projectPendingXp: never past the last level, never a
 * prestige or a Legend), and the day's allowances they used.
 *
 * Allowances count only games stamped with the same UTC day as the
 * confirmed progress's allowances (the API's own stamp), so a new day starts
 * from what the API says. A pending public game that took the first-game
 * bonus marks it taken; pending private and singleplayer games count towards
 * their daily caps.
 *
 * An entry stored before these were kept has no day, kind or bonus: it is
 * taken to have used the first-game bonus when it was stored on that UTC day
 * by the local clock (the safe side: the next game's figure is never
 * overstated), and to count towards neither cap (its kind is unknown).
 */
export function stackPendingXp(
  progress: Progress,
  pending: readonly PendingXp[],
  config: ProgressionConfig,
): Progress {
  if (pending.length === 0) return progress;
  const xp = pending.reduce((sum, e) => sum + e.xp, 0);
  const projected = projectPendingXp(progress, xp, config);
  const stacked: Progress =
    projected === null
      ? { ...progress }
      : {
          ...progress,
          ...projected,
        };
  const daily = progress.daily;
  if (daily?.day === undefined) return stacked;
  let { privateGames, singleplayerGames, firstGameClaimed } = daily;
  for (const entry of pending) {
    if (entry.day === undefined) {
      if (utcDay(entry.at) === daily.day) firstGameClaimed = true;
      continue;
    }
    if (entry.day !== daily.day) continue;
    if (entry.kind === "private") privateGames++;
    if (entry.kind === "singleplayer") singleplayerGames++;
    if (entry.firstGame === true) firstGameClaimed = true;
  }
  stacked.daily = {
    ...daily,
    privateGames,
    singleplayerGames,
    firstGameClaimed,
  };
  return stacked;
}

/**
 * The confirmed progress with the account's other pending games stacked on
 * top (stackPendingXp), for a provisional figure worked out now. Each one is
 * asked about first, after `progress` was read: one the API has scored is
 * in `progress` already, so it is cleared rather than counted twice, and
 * only a 404 counts one. `excludeGameId` is the game being worked out.
 */
export async function progressWithPendingXp(opts: {
  publicId: string;
  progress: Progress;
  config: ProgressionConfig;
  excludeGameId: string;
  fetchXp: (gameId: string) => Promise<GameXpFetchResult>;
  now?: number;
}): Promise<Progress> {
  const now = opts.now ?? Date.now();
  const entries = readPendingXp(opts.publicId, now).filter(
    (e) => e.gameId !== opts.excludeGameId,
  );
  if (entries.length === 0) return opts.progress;
  const answers = await Promise.all(
    entries.map((e) =>
      opts
        .fetchXp(e.gameId)
        .catch((): GameXpFetchResult => ({ status: "pending" })),
    ),
  );
  const counted: PendingXp[] = [];
  const answered: string[] = [];
  entries.forEach((entry, i) => {
    const answer = answers[i];
    if (answer.status === "ok") answered.push(entry.gameId);
    else if (answer.status === "pending" && answer.notFound === true) {
      counted.push(entry);
    }
  });
  clearPendingXp(opts.publicId, answered, now);
  return stackPendingXp(opts.progress, counted, opts.config);
}

// ----------------------------------------------------------------- display

/** Sent on document whenever what provisionalProgress() returns may change. */
export const PROVISIONAL_PROGRESS_CHANGED = "provisional-progress-changed";

export interface ProvisionalChange {
  // Games the API has just scored: progress read before now leaves them out.
  scored: readonly string[];
}

/** The games a PROVISIONAL_PROGRESS_CHANGED event says were just scored. */
export function scoredGames(event: Event): readonly string[] {
  return (event as CustomEvent<ProvisionalChange | null>).detail?.scored ?? [];
}

export interface ProvisionalView<P> {
  // The progress to show: the projected one when provisional, else the
  // confirmed one itself.
  progress: P;
  provisional: boolean;
  // The confirmed level: levels past it are only provisionally reached.
  confirmedLevel: number;
}

export interface ProvisionalDeps {
  // GET /users/@me/xp/:gameId.
  fetchXp: (gameId: string) => Promise<GameXpFetchResult>;
  // GET /public/progression/config.
  loadConfig: () => Promise<ProgressionConfig | false>;
  // Re-reads /users/@me and broadcasts it (userMeResponse); false when it
  // couldn't.
  refreshUserMe: () => Promise<unknown>;
  now?: () => number;
  // How often to ask again while games are pending, and how many times per
  // page at most.
  pollMs?: number;
  maxPolls?: number;
}

export const PROVISIONAL_POLL_MS = 60_000;
export const PROVISIONAL_MAX_POLLS = 120;

interface Verified {
  account: string;
  // The check's sequence number: a confirmed figure first seen before it is
  // older than its answers.
  seq: number;
  // The games it found still unscored (a 404).
  pending: ReadonlySet<string>;
}

let deps: ProvisionalDeps | null = null;
let account: string | null = null;
let config: ProgressionConfig | null = null;
let verified: Verified | null = null;
// Orders confirmed figures against checks.
let seq = 0;
const seenAt = new WeakMap<object, number>();
// The projected view per confirmed figure, so its identity holds while
// nothing changes (the account menu animates on a new one).
const views = new WeakMap<
  object,
  { xp: number; config: ProgressionConfig; view: ProvisionalView<unknown> }
>();
let inFlight: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setInterval> | null = null;
let polls = 0;
let lastCheckAt = 0;
let removeListeners: (() => void) | null = null;

function now(): number {
  return deps?.now?.() ?? Date.now();
}

function seen(confirmed: object): number {
  let at = seenAt.get(confirmed);
  if (at === undefined) {
    at = ++seq;
    seenAt.set(confirmed, at);
  }
  return at;
}

/**
 * The player's progress as it should show: projected with their pending
 * provisional XP when `publicId` is the signed-in account and the pending
 * games are known to be unscored, else `confirmed` as it is. Only ever for
 * the player's own progress: anyone else's publicId gets it unchanged.
 */
export function provisionalProgress<P extends ProgressLike>(
  publicId: string | null | undefined,
  confirmed: P,
): ProvisionalView<P> {
  const plain: ProvisionalView<P> = {
    progress: confirmed,
    provisional: false,
    confirmedLevel: confirmed.level,
  };
  if (deps === null || !publicId || publicId !== account) return plain;
  const entries = readPendingXp(publicId, now());
  if (entries.length === 0) return plain;
  const seenSeq = seen(confirmed);
  const check = verified;
  if (check === null || check.account !== publicId || seenSeq >= check.seq) {
    // Read since the last check: it may already count a pending game.
    scheduleCheck();
    return plain;
  }
  const xp = entries
    .filter((e) => check.pending.has(e.gameId))
    .reduce((sum, e) => sum + e.xp, 0);
  if (config === null || xp <= 0) return plain;
  const cached = views.get(confirmed);
  if (cached !== undefined && cached.xp === xp && cached.config === config) {
    return cached.view as ProvisionalView<P>;
  }
  const projected = projectPendingXp(confirmed, xp, config);
  if (projected === null) return plain;
  const view: ProvisionalView<P> = {
    progress: { ...confirmed, ...projected },
    provisional: true,
    confirmedLevel: confirmed.level,
  };
  views.set(confirmed, { xp, config, view });
  return view;
}

function emitChanged(scored: readonly string[] = []): void {
  document.dispatchEvent(
    new CustomEvent<ProvisionalChange>(PROVISIONAL_PROGRESS_CHANGED, {
      detail: { scored },
    }),
  );
}

/**
 * Whether provisionalProgress() has the final say on `confirmed`: there is
 * nothing pending, or a check has run since it was read. Until then a figure
 * read since the last check shows unprojected while that check runs.
 */
export function provisionalSettled(
  publicId: string | null | undefined,
  confirmed: object,
): boolean {
  if (deps === null || !publicId || publicId !== account) return true;
  if (readPendingXp(publicId, now()).length === 0) return true;
  const check = verified;
  return (
    check !== null && check.account === publicId && seen(confirmed) < check.seq
  );
}

/**
 * For a view of progress read once (a modal's own read, not /users/@me),
 * which has to be read again when a pending game is scored: from then until
 * the new read lands and settles, the last provisional view stays on screen,
 * so the level never dips back to the figure from before the game.
 */
export class ProvisionalHold<P extends ProgressLike> {
  private last: ProvisionalView<P> | null = null;
  private held: ProvisionalView<P> | null = null;
  // The progress the held view was projected from: still showing it means
  // the new read hasn't landed.
  private heldFrom: P | null = null;

  view(publicId: string | null | undefined, confirmed: P): ProvisionalView<P> {
    const view = provisionalProgress(publicId, confirmed);
    if (this.held !== null) {
      const waiting =
        confirmed === this.heldFrom ||
        (!view.provisional && !provisionalSettled(publicId, confirmed));
      if (waiting) return this.held;
      this.held = null;
      this.heldFrom = null;
    }
    this.last = view;
    return view;
  }

  /**
   * A pending game was scored and `confirmed` is about to be read again.
   * True when what shows was provisional, so it's held (and worth the read).
   */
  hold(confirmed: P): boolean {
    if (this.last?.provisional !== true) return false;
    this.held = this.last;
    this.heldFrom = confirmed;
    return true;
  }

  /** Shows whatever the progress now gives (a new opening, a failed read). */
  reset(): void {
    this.last = null;
    this.held = null;
    this.heldFrom = null;
  }
}

function scheduleCheck(): void {
  // Out of the render that asked.
  void Promise.resolve().then(() => runCheck());
}

/**
 * Asks the API about every pending game: one it has scored (or found
 * ineligible) is cleared, and /users/@me re-read so the confirmed figure
 * shows; a 404 keeps it pending, and counted. Anything else (a failure, a
 * refused session) keeps it, uncounted, until the next check or its expiry.
 */
export function runCheck(): Promise<void> {
  if (deps === null) return Promise.resolve();
  if (inFlight !== null) {
    again = true;
    return inFlight;
  }
  const d = deps;
  const forAccount = account;
  if (forAccount === null) return Promise.resolve();
  const entries = readPendingXp(forAccount, now());
  if (entries.length === 0) {
    syncPolling();
    return Promise.resolve();
  }
  const checkSeq = ++seq;
  lastCheckAt = now();
  const run = (async () => {
    const [loaded, answers] = await Promise.all([
      d.loadConfig().catch(() => false as const),
      Promise.all(
        entries.map((e) =>
          d
            .fetchXp(e.gameId)
            .catch((): GameXpFetchResult => ({ status: "pending" })),
        ),
      ),
    ]);
    if (deps !== d || account !== forAccount) return;
    const pending = new Set<string>();
    const answered: string[] = [];
    entries.forEach((entry, i) => {
      const answer = answers[i];
      if (answer.status === "ok") answered.push(entry.gameId);
      else if (answer.status === "pending" && answer.notFound === true) {
        pending.add(entry.gameId);
      }
    });
    // The confirmed figure first, so the level never dips to the old one
    // between the entry going and the new figure arriving.
    let scored: string[] = [];
    if (answered.length > 0) {
      const refreshed = await d.refreshUserMe().catch(() => false);
      if (deps !== d || account !== forAccount) return;
      if (refreshed === false) {
        // No new figure: the one showing still leaves these games out, so
        // they keep counting until a later check gets one.
        for (const gameId of answered) pending.add(gameId);
      } else {
        clearPendingXp(forAccount, answered, now());
        scored = answered;
      }
    }
    config = loaded === false ? null : loaded;
    verified = { account: forAccount, seq: checkSeq, pending };
    emitChanged(scored);
    syncPolling();
  })();
  inFlight = run.finally(() => {
    inFlight = null;
    if (again) {
      again = false;
      void runCheck();
    }
  });
  return inFlight;
}

/** Checks now: a provisional figure was just stored. */
export function requestProvisionalCheck(): void {
  if (deps !== null) void runCheck();
}

function maxPolls(): number {
  return deps?.maxPolls ?? PROVISIONAL_MAX_POLLS;
}

function pollMs(): number {
  return deps?.pollMs ?? PROVISIONAL_POLL_MS;
}

// Polls while the account has games pending, up to the cap.
function syncPolling(): void {
  const want =
    deps !== null &&
    account !== null &&
    polls < maxPolls() &&
    readPendingXp(account, now()).length > 0;
  if (want && timer === null) {
    timer = setInterval(poll, pollMs());
  } else if (!want && timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function poll(): void {
  // Only while someone can see it.
  if (document.visibilityState !== "visible") return;
  polls++;
  void runCheck();
  if (polls >= maxPolls()) syncPolling();
}

function onVisibilityChange(): void {
  // Back on the page after a while: ask now rather than at the next tick.
  if (timer !== null && now() - lastCheckAt >= pollMs()) poll();
}

function setAccount(next: string | null): void {
  if (next === account) return;
  account = next;
  verified = null;
  polls = 0;
  emitChanged();
}

function onUserMe(event: Event): void {
  const me = (event as CustomEvent<UserMeResponse | false>).detail;
  setAccount(me === false ? null : (me?.player?.publicId ?? null));
  if (account === null) {
    syncPolling();
    return;
  }
  // Seen now, before the check below: that check's answers vouch for it.
  const progress = me === false ? undefined : me?.player?.progress;
  if (progress) seen(progress);
  void runCheck();
}

function onSessionCleared(): void {
  setAccount(null);
  syncPolling();
}

/**
 * Starts following the signed-in account (its userMeResponse broadcasts) and
 * checking its pending games. Main calls this before the first broadcast.
 * Returns a stop function (tests).
 */
export function startProvisionalProgress(d: ProvisionalDeps): () => void {
  stopProvisionalProgress();
  deps = d;
  document.addEventListener("userMeResponse", onUserMe);
  document.addEventListener("session-cleared", onSessionCleared);
  document.addEventListener("visibilitychange", onVisibilityChange);
  removeListeners = () => {
    document.removeEventListener("userMeResponse", onUserMe);
    document.removeEventListener("session-cleared", onSessionCleared);
    document.removeEventListener("visibilitychange", onVisibilityChange);
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
  verified = null;
  inFlight = null;
  again = false;
  polls = 0;
  lastCheckAt = 0;
}
