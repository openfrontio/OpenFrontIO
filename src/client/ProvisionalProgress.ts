import type {
  GameXpResponse,
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
// it, and it fails closed (no config, an API that predates any of this: the
// confirmed figures show).
//
// No double counting, and no dropping back, decided by lifetime XP alone.
// Every figure of the player's progress (/users/@me, the public progress,
// however stale its replica) carries lifetimeXp, which only grows as games
// are scored:
// - A scored game keeps its entry, marked with the XP the API gave it and
//   the lifetime XP it took the player to (`scored`). A figure below that
//   lifetime doesn't include it yet, so its XP is added; one at or above it
//   does. The result is the API's own figure: confirmed, not provisional.
// - An unscored game is added only onto a figure at or below `notIn`: the
//   highest lifetime XP of a figure read before the API said (404) it hadn't
//   scored the game. A figure above it may include the game, so it shows
//   without it until the next check raises `notIn`.

// ------------------------------------------------------------------ storage

export const PENDING_XP_KEY = "provisionalXp";
// When a tab last asked the API, per account: the others skip their poll.
export const PENDING_XP_CHECKED_KEY = "provisionalXpCheckedAt";
// A game is long scored by then; past it an entry is dropped unasked.
export const PENDING_XP_TTL_MS = 12 * 60 * 60 * 1000;
// More than this many games and the oldest go, scored ones first.
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
  // count the day's allowances twice.
  // The UTC day the API stamped the daily allowances with ("YYYY-MM-DD").
  day?: string;
  kind?: PendingGameKind;
  // Its figure took the first-public-game-of-the-day bonus.
  firstGame?: boolean;
  // Unscored: the highest lifetime XP of a figure known not to include it.
  notIn?: number;
  // Scored: the XP the API gave it, and the lifetime XP that took the
  // player to.
  scored?: { xp: number; lifetimeAfter: number };
}

export interface PendingXpInput {
  gameId: string;
  xp: number;
  day?: string | null;
  kind?: PendingGameKind | null;
  firstGame?: boolean;
  // The lifetime XP of the figure the provisional XP was worked out from:
  // read before the game ended, so the game can't be in it.
  notIn?: number;
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

const isCount = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;

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
  if (isCount(v.notIn)) entry.notIn = v.notIn;
  const scored = v.scored as Record<string, unknown> | null | undefined;
  if (
    typeof scored === "object" &&
    scored !== null &&
    isCount(scored.xp) &&
    isCount(scored.lifetimeAfter)
  ) {
    entry.scored = { xp: scored.xp, lifetimeAfter: scored.lifetimeAfter };
  }
  return entry;
}

function isLive(entry: PendingXp, now: number): boolean {
  // Either way: a clock set back mustn't keep an entry forever.
  return Math.abs(now - entry.at) < PENDING_XP_TTL_MS;
}

function parseStore(raw: string | null, now: number): PendingStore {
  const out: PendingStore = {};
  if (raw === null) return out;
  try {
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
    // Unreadable: nothing pending.
  }
  return out;
}

function readStore(now: number): PendingStore {
  try {
    return parseStore(localStorage.getItem(PENDING_XP_KEY), now);
  } catch {
    // Blocked storage: nothing pending.
    return {};
  }
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

// Changes the account's entries, written back pruned (expired entries, any
// account's, go).
function updateList(
  publicId: string,
  now: number,
  change: (list: PendingXp[]) => PendingXp[],
): void {
  if (!publicId) return;
  const store = readStore(now);
  const list = change(listFor(store, publicId));
  if (list.length > 0) store[publicId] = list;
  else delete store[publicId];
  writeStore(store);
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
    notIn: entry.notIn,
  });
  if (pending === null) return;
  updateList(publicId, now, (current) => {
    const list = current.filter((e) => e.gameId !== entry.gameId);
    list.push(pending);
    // Over the cap: scored games go first (the API has them), oldest first.
    while (list.length > MAX_PENDING_PER_ACCOUNT) {
      const scored = list.findIndex((e) => e.scored !== undefined);
      list.splice(scored >= 0 ? scored : 0, 1);
    }
    return list;
  });
}

/**
 * The API's answer for a game: an eligible one is marked scored (kept, so a
 * figure that doesn't include it yet still counts it), an ineligible one is
 * dropped (there is nothing to add).
 */
export function applyGameXp(
  publicId: string,
  response: GameXpResponse,
  now: number = Date.now(),
): void {
  applyVerdicts(
    publicId,
    new Map([[response.gameId, verdictOf(response)]]),
    now,
  );
}

/** Drops the account's entries for these games. */
export function clearPendingXp(
  publicId: string,
  gameIds: Iterable<string>,
  now: number = Date.now(),
): void {
  const drop = new Set(gameIds);
  if (drop.size === 0) return;
  updateList(publicId, now, (list) => list.filter((e) => !drop.has(e.gameId)));
}

type Verdict =
  | { kind: "scored"; xp: number; lifetimeAfter: number }
  | { kind: "ineligible" }
  // A 404: not scored, so not in any figure up to this lifetime XP.
  | { kind: "not_scored"; notIn: number };

function verdictOf(response: GameXpResponse): Verdict {
  return response.eligible
    ? {
        kind: "scored",
        xp: response.breakdown.total,
        lifetimeAfter: response.after.lifetimeXp,
      }
    : { kind: "ineligible" };
}

function applyVerdicts(
  publicId: string,
  verdicts: ReadonlyMap<string, Verdict>,
  now: number,
): void {
  if (verdicts.size === 0) return;
  updateList(publicId, now, (list) =>
    list.flatMap((e): PendingXp[] => {
      const verdict = verdicts.get(e.gameId);
      if (verdict === undefined) return [e];
      switch (verdict.kind) {
        case "ineligible":
          return [];
        case "scored":
          return [
            {
              ...e,
              scored: { xp: verdict.xp, lifetimeAfter: verdict.lifetimeAfter },
            },
          ];
        case "not_scored":
          // Read since: another tab may have scored it meanwhile.
          if (e.scored !== undefined) return [e];
          return [{ ...e, notIn: Math.max(e.notIn ?? 0, verdict.notIn) }];
      }
    }),
  );
}

/**
 * Asks the API about unscored games, one at a time (the endpoint is rate
 * limited), stopping at a 429. `seenLifetime` is the highest lifetime XP of a
 * figure read before the first question: a 404 says the game isn't in it.
 * Anything but an answer or a 404 leaves the game's verdict as it was.
 */
async function askAbout(
  entries: readonly PendingXp[],
  seenLifetime: number | null,
  fetchXp: (gameId: string) => Promise<GameXpFetchResult>,
): Promise<{ verdicts: Map<string, Verdict>; rateLimited: boolean }> {
  const verdicts = new Map<string, Verdict>();
  for (const entry of entries) {
    const answer = await fetchXp(entry.gameId).catch(
      (): GameXpFetchResult => ({ status: "pending" }),
    );
    if (answer.status === "ok") {
      verdicts.set(entry.gameId, verdictOf(answer.data));
    } else if (answer.status === "pending" && answer.notFound === true) {
      if (seenLifetime !== null) {
        verdicts.set(entry.gameId, { kind: "not_scored", notIn: seenLifetime });
      }
    } else if (answer.status === "pending" && answer.rateLimited === true) {
      return { verdicts, rateLimited: true };
    }
  }
  return { verdicts, rateLimited: false };
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

/**
 * Which of the account's entries count onto a figure with this lifetime XP:
 * the scored games it doesn't include yet, and the unscored games known not
 * to be in it. `unverified` is whether an unscored game is left out because
 * the figure is newer than the last check: a check would settle it.
 */
export function pendingXpFor(
  figure: { lifetimeXp: number },
  entries: readonly PendingXp[],
): { scored: PendingXp[]; unscored: PendingXp[]; unverified: boolean } {
  const scored: PendingXp[] = [];
  const unscored: PendingXp[] = [];
  let unverified = false;
  for (const e of entries) {
    if (e.scored !== undefined) {
      if (figure.lifetimeXp < e.scored.lifetimeAfter) scored.push(e);
    } else if (e.notIn !== undefined && figure.lifetimeXp <= e.notIn) {
      unscored.push(e);
    } else {
      unverified = true;
    }
  }
  return { scored, unscored, unverified };
}

const xpOf = (e: PendingXp) => e.scored?.xp ?? e.xp;
const sumXp = (list: readonly PendingXp[]) =>
  list.reduce((sum, e) => sum + xpOf(e), 0);

// ------------------------------------------------------------------ stacking

/**
 * The confirmed progress with pending games stacked on top, for the next
 * game's provisional figure at death: the place on the level track their XP
 * takes it to (as projectPendingXp: never past the last level, never a
 * prestige or a Legend; a scored game counts the API's XP), and the day's
 * allowances they used. Pass only the games the figure doesn't include
 * (pendingXpFor).
 *
 * Allowances count only games stamped with the same UTC day as the
 * confirmed progress's allowances (the API's own stamp), so a new day starts
 * from what the API says. A pending public game that took the first-game
 * bonus marks it taken; pending private and singleplayer games count towards
 * their daily caps.
 */
export function stackPendingXp(
  progress: Progress,
  pending: readonly PendingXp[],
  config: ProgressionConfig,
): Progress {
  if (pending.length === 0) return progress;
  const projected = projectPendingXp(progress, sumXp(pending), config);
  const stacked: Progress =
    projected === null ? { ...progress } : { ...progress, ...projected };
  const daily = progress.daily;
  if (daily?.day === undefined) return stacked;
  let { privateGames, singleplayerGames, firstGameClaimed } = daily;
  for (const entry of pending) {
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
 * top (stackPendingXp), for a provisional figure worked out now. Unscored
 * games are asked about first, after `progress` was read, so the answers say
 * whether it includes them. `excludeGameId` is the game being worked out.
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
  const others = () =>
    readPendingXp(opts.publicId, now).filter(
      (e) => e.gameId !== opts.excludeGameId,
    );
  const unscored = others().filter((e) => e.scored === undefined);
  if (unscored.length > 0) {
    const { verdicts } = await askAbout(
      unscored,
      opts.progress.lifetimeXp,
      opts.fetchXp,
    );
    applyVerdicts(opts.publicId, verdicts, now);
  }
  const { scored, unscored: counted } = pendingXpFor(opts.progress, others());
  return stackPendingXp(opts.progress, [...scored, ...counted], opts.config);
}

// ----------------------------------------------------------------- display

/** Sent on document whenever what provisionalProgress() returns may change. */
export const PROVISIONAL_PROGRESS_CHANGED = "provisional-progress-changed";

export interface ProvisionalChange {
  // Games the API has just scored: a view that read its own progress (a
  // modal) reads it again, for the history and milestones.
  scored: readonly string[];
}

/** The games a PROVISIONAL_PROGRESS_CHANGED event says were just scored. */
export function scoredGames(event: Event): readonly string[] {
  return (event as CustomEvent<ProvisionalChange | null>).detail?.scored ?? [];
}

export interface ProvisionalView<P> {
  // The progress to show: with the pending games' XP when any count, else
  // the confirmed one itself.
  progress: P;
  // Counts XP from games the API hasn't scored yet.
  provisional: boolean;
  // The confirmed level (with any scored games the figure doesn't include
  // yet): levels past it are only provisionally reached.
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
  // How often to ask again while games are pending, and how many times per
  // page at most.
  pollMs?: number;
  maxPolls?: number;
}

export const PROVISIONAL_POLL_MS = 60_000;
export const PROVISIONAL_MAX_POLLS = 120;

let deps: ProvisionalDeps | null = null;
let account: string | null = null;
let config: ProgressionConfig | null = null;
let configLoading = false;
// The highest lifetime XP of the account's figures read so far.
let seenLifetime: number | null = null;
// The seenLifetime the last check asked with: a figure up to it has had its
// check, so showing it again asks nothing more (and storage that won't keep
// the answers can't start a loop of checks).
let checkedLifetime: number | null = null;
// The account's games known scored, to tell what a storage event changed.
let knownScored = new Set<string>();
// The projected view per confirmed figure, so its identity holds while
// nothing changes (the account menu animates on a new one).
const views = new WeakMap<
  object,
  { key: string; config: ProgressionConfig; view: ProvisionalView<unknown> }
>();
let inFlight: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setInterval> | null = null;
let polls = 0;
let removeListeners: (() => void) | null = null;

/** Whether this publicId is the signed-in account the store follows. */
export function isOwnAccount(publicId: string | null | undefined): boolean {
  return deps !== null && !!publicId && publicId === account;
}

function now(): number {
  return deps?.now?.() ?? Date.now();
}

function noteSeen(lifetimeXp: number): void {
  if (!Number.isFinite(lifetimeXp)) return;
  seenLifetime =
    seenLifetime === null ? lifetimeXp : Math.max(seenLifetime, lifetimeXp);
}

/**
 * The player's progress as it should show: with the XP of their pending
 * games when `publicId` is the signed-in account, else `confirmed` as it is.
 * Scored games the figure doesn't include yet are confirmed XP; unscored ones
 * make it provisional. Only ever for the player's own progress: anyone
 * else's publicId gets it unchanged.
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
  noteSeen(confirmed.lifetimeXp);
  const entries = readPendingXp(publicId, now());
  if (entries.length === 0) return plain;
  const { scored, unscored, unverified } = pendingXpFor(confirmed, entries);
  if (unverified && newerThanCheck(confirmed.lifetimeXp)) scheduleCheck();
  if (config === null) {
    ensureConfig();
    return plain;
  }
  const scoredXp = sumXp(scored);
  const unscoredXp = sumXp(unscored);
  if (scoredXp <= 0 && unscoredXp <= 0) return plain;
  const key = `${scoredXp}:${unscoredXp}`;
  const cached = views.get(confirmed);
  if (cached !== undefined && cached.key === key && cached.config === config) {
    return cached.view as ProvisionalView<P>;
  }
  // The scored games first: the API's own figure, confirmed.
  const base: ProgressLike =
    (scoredXp > 0 ? projectPendingXp(confirmed, scoredXp, config) : null) ??
    confirmed;
  const projected =
    unscoredXp > 0 ? projectPendingXp(base, unscoredXp, config) : null;
  if (base === confirmed && projected === null) return plain;
  const view: ProvisionalView<P> = {
    progress: { ...confirmed, ...base, ...projected },
    provisional: projected !== null,
    confirmedLevel: base.level,
  };
  views.set(confirmed, { key, config, view });
  return view;
}

function emitChanged(scored: readonly string[] = []): void {
  document.dispatchEvent(
    new CustomEvent<ProvisionalChange>(PROVISIONAL_PROGRESS_CHANGED, {
      detail: { scored },
    }),
  );
}

function broadcastUserMe(me: UserMeResponse): void {
  document.dispatchEvent(
    new CustomEvent("userMeResponse", {
      detail: me,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function ensureConfig(): void {
  const d = deps;
  if (d === null || config !== null || configLoading) return;
  configLoading = true;
  void d
    .loadConfig()
    .catch(() => false as const)
    .then((loaded) => {
      if (deps !== d) return;
      configLoading = false;
      // No config: no projection (an older API, or progression off).
      if (loaded === false) return;
      config = loaded;
      emitChanged();
    });
}

// Whether a figure with this lifetime XP is newer than the last check.
function newerThanCheck(lifetimeXp: number): boolean {
  return checkedLifetime === null || lifetimeXp > checkedLifetime;
}

function scheduleCheck(): void {
  // Out of the render that asked. Not behind a check already running: the
  // render after it asks again if the figure is still newer.
  void Promise.resolve().then(() => {
    if (inFlight === null) void runCheck();
  });
}

function readCheckedAt(publicId: string): number | null {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(PENDING_XP_CHECKED_KEY) ?? "{}",
    );
    const at = (parsed as Record<string, unknown> | null)?.[publicId];
    return typeof at === "number" && Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

function writeCheckedAt(publicId: string, at: number): void {
  try {
    localStorage.setItem(
      PENDING_XP_CHECKED_KEY,
      JSON.stringify({ [publicId]: at }),
    );
  } catch {
    // Blocked storage: other tabs just ask too.
  }
}

function scoredIds(publicId: string): Set<string> {
  return new Set(
    readPendingXp(publicId, now())
      .filter((e) => e.scored !== undefined)
      .map((e) => e.gameId),
  );
}

/**
 * Asks the API about the account's unscored games. A game it has scored is
 * marked scored, and /users/@me read afresh; before that is broadcast, the
 * games still unscored are asked about again, so the new figure counts them
 * from the start (no dip). Correctness never depends on that read: a scored
 * game counts onto any figure that doesn't include it yet.
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
  const unscored = () =>
    readPendingXp(forAccount, now()).filter((e) => e.scored === undefined);
  const first = unscored();
  if (first.length === 0) {
    syncPolling();
    return Promise.resolve();
  }
  writeCheckedAt(forAccount, now());
  const run = (async () => {
    ensureConfig();
    checkedLifetime = seenLifetime;
    const asked = await askAbout(first, seenLifetime, d.fetchXp);
    if (deps !== d || account !== forAccount) return;
    applyVerdicts(forAccount, asked.verdicts, now());
    const scoredIn = (verdicts: Map<string, Verdict>) =>
      [...verdicts]
        .filter(([, v]) => v.kind === "scored")
        .map(([gameId]) => gameId);
    const scored = scoredIn(asked.verdicts);
    let fresh: UserMeResponse | false = false;
    if (scored.length > 0) {
      fresh = await d.readUserMe().catch(() => false as const);
      if (deps !== d || account !== forAccount) return;
      if (fresh !== false && fresh.player.publicId !== forAccount) {
        fresh = false;
      }
      const lifetime = fresh === false ? undefined : fresh.player.progress;
      if (lifetime !== undefined && !asked.rateLimited) {
        noteSeen(lifetime.lifetimeXp);
        const rest = unscored();
        if (rest.length > 0) {
          checkedLifetime = seenLifetime;
          const second = await askAbout(rest, seenLifetime, d.fetchXp);
          if (deps !== d || account !== forAccount) return;
          applyVerdicts(forAccount, second.verdicts, now());
          scored.push(...scoredIn(second.verdicts));
        }
      }
    }
    knownScored = scoredIds(forAccount);
    if (fresh !== false) broadcastUserMe(fresh);
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

// Polls while the account has unscored games, up to the cap.
function syncPolling(): void {
  const want =
    deps !== null &&
    account !== null &&
    polls < maxPolls() &&
    readPendingXp(account, now()).some((e) => e.scored === undefined);
  if (want && timer === null) {
    timer = setInterval(poll, pollMs());
  } else if (!want && timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function poll(): void {
  // Only while someone can see it, and not when another tab just asked (its
  // answers arrive through storage).
  if (account === null || document.visibilityState !== "visible") return;
  const checkedAt = readCheckedAt(account);
  if (checkedAt !== null && now() - checkedAt < pollMs()) return;
  polls++;
  void runCheck();
  if (polls >= maxPolls()) syncPolling();
}

function onVisibilityChange(): void {
  // Back on the page after a while: ask now rather than at the next tick.
  if (timer !== null) poll();
}

// Another tab changed the pending games: show it, and read the account
// afresh when it marked one scored.
function onStorage(event: StorageEvent): void {
  if (event.key !== PENDING_XP_KEY && event.key !== null) return;
  const d = deps;
  const forAccount = account;
  if (d === null || forAccount === null) return;
  const scored = scoredIds(forAccount);
  const newly = [...scored].filter((id) => !knownScored.has(id));
  knownScored = scored;
  emitChanged(newly);
  syncPolling();
  if (newly.length === 0) return;
  void d
    .readUserMe()
    .catch(() => false as const)
    .then((fresh) => {
      if (deps !== d || account !== forAccount || fresh === false) return;
      if (fresh.player.publicId !== forAccount) return;
      broadcastUserMe(fresh);
    });
}

function setAccount(next: string | null): void {
  if (next === account) return;
  account = next;
  seenLifetime = null;
  checkedLifetime = null;
  knownScored = next === null ? new Set() : scoredIds(next);
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
  const progress = me === false ? undefined : me?.player?.progress;
  if (progress !== undefined) noteSeen(progress.lifetimeXp);
  ensureConfig();
  // Asked about only when this figure is newer than what the last check
  // vouched for (or nothing has been asked yet).
  const entries = readPendingXp(account, now());
  if (
    progress !== undefined &&
    pendingXpFor(progress, entries).unverified &&
    newerThanCheck(progress.lifetimeXp)
  ) {
    void runCheck();
  } else {
    syncPolling();
  }
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
  window.addEventListener("storage", onStorage);
  removeListeners = () => {
    document.removeEventListener("userMeResponse", onUserMe);
    document.removeEventListener("session-cleared", onSessionCleared);
    document.removeEventListener("visibilitychange", onVisibilityChange);
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
  configLoading = false;
  seenLifetime = null;
  checkedLifetime = null;
  knownScored = new Set();
  inFlight = null;
  again = false;
  polls = 0;
}
