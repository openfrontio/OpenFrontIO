import type {
  GameXpEligible,
  GameXpResponse,
  Progress,
  ProgressionConfig,
  XpRules,
} from "../core/ApiSchemas";
import { GameMode } from "../core/game/Game";
import type { HumanStatsSnapshot } from "../core/game/HumanStats";
import {
  applyMultipliers,
  computeXp,
  ffaOutlasted,
  NO_DAILY_XP,
  PROVISIONAL_XP_FORMULA,
  type XpBreakdown,
  type XpContext,
  type XpGameConfig,
  type XpResult,
} from "./ProvisionalXp";

// The provisional XP figure shown when the local player dies before the game
// ends (~99% of players), worked out in the browser with the copy of the
// API's formula in ProvisionalXp.ts. Display only: it is never sent anywhere,
// and once the game ends the server's figure replaces it (reconcileXp below
// says how they compare).

export interface ProvisionalXp {
  // The figure shaped like the server's GET /users/@me/xp/:gameId answer, so
  // the XP panel draws both the same way. An eligible one carries the bar's
  // projected position and the levels it reaches, which are celebrated then:
  // most players die before the end and would otherwise miss them.
  response: GameXpResponse;
  result: XpResult;
  // A team (or Humans vs Nations) game: the team may still win, and a win
  // bonus is only known once it ends.
  teamWinPending: boolean;
  // Feats pay XP under these rules (featXp > 0), and they are only judged on
  // the finished game. With feats paying nothing there is nothing to add.
  featsPending: boolean;
  // What the figure was worked out from, for the mismatch log. No ids, no
  // names.
  inputs: ProvisionalXpInputs;
}

export interface ProvisionalXpInputs {
  gameType: string;
  gameMode: string;
  playerTeams: unknown;
  ranked: boolean;
  aliveTicks: number;
  spawnedHumans: number;
  opponentsOutlasted: number;
  // Opponents counted as having left before this player died: they had
  // disconnected and may yet come back, which the API would not count.
  disconnectedOpponents: number;
  daily: XpContext["daily"];
  subscriberPermille: number;
}

/**
 * The XP rules to run the formula on, or null when the API's formula is not
 * the revision this client carries (or it predates the field): then there is
 * no provisional figure.
 */
export function provisionalXpRules(config: ProgressionConfig): XpRules | null {
  if (config.formula !== PROVISIONAL_XP_FORMULA) return null;
  return config.xp ?? null;
}

/**
 * computeXp's context for the local player at the moment they died, from the
 * worker's stats snapshot. "retry" when the snapshot doesn't show the death
 * yet (the simulation stamps it a tick after the last tile falls).
 *
 * Derived the way the API derives it from the archived record (its
 * GameInputs.ts), with what can only be known at the end left out: no win
 * (a dead player can't win FFA; a team's result is pending), no feats (they
 * are judged on the finished game), and no leave (the player is still here).
 * The first game of the day is known now: the daily state from /users/@me
 * says whether it is still open, and the game type whether this game pays it.
 */
export function provisionalXpContext(input: {
  snapshot: HumanStatsSnapshot;
  myClientID: string;
  config: XpGameConfig;
  progress: Progress;
}): { ctx: XpContext; disconnectedOpponents: number } | "retry" {
  const { snapshot, myClientID, config, progress } = input;
  const myStats = snapshot.stats[myClientID];
  if (myStats !== undefined && myStats.killedAt === undefined) return "retry";
  const killedAt =
    myStats?.killedAt === undefined ? snapshot.tick : Number(myStats.killedAt);
  // The game so far. The API passes the whole game's length, which only
  // matters for a team win (pending here) and to cap the elimination tick.
  const ticks = Math.max(snapshot.tick, killedAt);

  const players = Object.entries(snapshot.stats).map(([clientID, stats]) => ({
    clientID,
    stats,
  }));
  // People who spawned: humans with stats. The API resolves accounts, so a
  // reconnect under a second client id counts once there; it can't here.
  const spawnedHumans = players.filter((p) => p.stats !== undefined).length;

  // Who had already gone out when this player did. A disconnected opponent
  // went out when they disconnected, as the API reads a player who never
  // came back; one who comes back later isn't counted there.
  const leftAt = new Map<string, number>();
  let disconnectedOpponents = 0;
  for (const [clientID, tick] of Object.entries(snapshot.disconnectedAt)) {
    if (clientID === myClientID) continue;
    leftAt.set(clientID, tick);
    if (snapshot.stats[clientID] !== undefined && tick < killedAt) {
      disconnectedOpponents++;
    }
  }
  const opponentsOutlasted =
    config.gameMode === GameMode.FFA
      ? (ffaOutlasted(players, ticks, leftAt).get(myClientID) ?? 0)
      : 0;

  return {
    ctx: {
      config,
      stats: myStats,
      leftAtTick: null,
      isWinner: false,
      ticks,
      spawnedHumans,
      opponentsOutlasted,
      featCount: 0,
      daily: progress.daily ?? NO_DAILY_XP,
      subscriberPermille: progress.subscriberPermille ?? 1000,
    },
    disconnectedOpponents,
  };
}

/**
 * Where `xp` would take the player on the level track: the API's applyXp,
 * with the level sizes from the config. Null when the config doesn't cover a
 * level it needs.
 */
export function projectProgress(
  progress: Progress,
  xp: number,
  config: ProgressionConfig,
): Pick<GameXpEligible, "before" | "after" | "levelsReached"> | null {
  const xpToNext = (level: number): number | undefined => {
    if (level >= config.maxLevel) return 0;
    const row = config.levels.find((l) => l.level === level);
    if (row !== undefined) return row.xpToNext;
    return level === progress.level ? progress.xpForNext : undefined;
  };
  const before = {
    prestige: progress.prestige,
    level: progress.level,
    xpInLevel: progress.xpInLevel,
    xpForNext: progress.xpForNext,
  };
  let { level, xpInLevel, legend } = progress;
  const levelsReached: { prestige: number; level: number }[] = [];
  if (xp > 0 && level < config.maxLevel) {
    xpInLevel += xp;
    while (level < config.maxLevel) {
      const need = xpToNext(level);
      if (need === undefined) return null;
      if (xpInLevel < need) break;
      xpInLevel -= need;
      level += 1;
      levelsReached.push({ prestige: progress.prestige, level });
    }
    if (level >= config.maxLevel) {
      xpInLevel = 0;
      legend = progress.prestige >= config.maxPrestige;
    }
  }
  const xpForNext = xpToNext(level);
  if (xpForNext === undefined) return null;
  return {
    before,
    after: {
      prestige: progress.prestige,
      level,
      xpInLevel,
      xpForNext,
      lifetimeXp: progress.lifetimeXp + Math.max(0, xp),
      legend,
      canPrestige:
        level >= config.maxLevel && progress.prestige < config.maxPrestige,
    },
    levelsReached,
  };
}

/** The provisional figure, or null when there is none to show. */
export function buildProvisionalXp(input: {
  gameId: string;
  snapshot: HumanStatsSnapshot;
  myClientID: string;
  config: XpGameConfig;
  progress: Progress;
  progression: ProgressionConfig;
}): ProvisionalXp | "retry" | null {
  const rules = provisionalXpRules(input.progression);
  if (rules === null) return null;
  const derived = provisionalXpContext(input);
  if (derived === "retry") return "retry";
  const { ctx, disconnectedOpponents } = derived;
  const result = computeXp(ctx, rules);
  let response: GameXpResponse;
  if (result.eligible) {
    const projected = projectProgress(
      input.progress,
      result.breakdown.total,
      input.progression,
    );
    if (projected === null) return null;
    response = {
      gameId: input.gameId,
      eligible: true,
      breakdown: result.breakdown,
      ...projected,
    };
  } else {
    response = {
      gameId: input.gameId,
      eligible: false,
      reason: result.reason,
    };
  }
  const killedAt = ctx.stats?.killedAt;
  return {
    response,
    result,
    teamWinPending: ctx.config.gameMode === GameMode.Team,
    featsPending: rules.featXp > 0 && rules.maxFeatsPerGame > 0,
    inputs: {
      gameType: ctx.config.gameType,
      gameMode: ctx.config.gameMode,
      playerTeams: ctx.config.playerTeams,
      ranked: ctx.config.rankedType !== undefined,
      aliveTicks: killedAt === undefined ? ctx.ticks : Number(killedAt),
      spawnedHumans: ctx.spawnedHumans,
      opponentsOutlasted: ctx.opponentsOutlasted,
      disconnectedOpponents,
      daily: ctx.daily,
      subscriberPermille: ctx.subscriberPermille,
    },
  };
}

export interface LoadProvisionalXpOptions {
  gameId: string;
  myClientID: string;
  config: XpGameConfig;
  progress: Progress;
  progression: ProgressionConfig;
  // The worker's stats snapshot (WorkerClient.humanStats).
  humanStats: () => Promise<HumanStatsSnapshot>;
  // How often, and how far apart, to ask again while the snapshot doesn't
  // show the death yet; and how long one answer may take.
  attempts?: number;
  retryMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Works out the provisional figure from the running game. Null when there is
 * none to show: another formula revision, no rules, a snapshot that never
 * shows the death, a worker that doesn't answer, or the caller gave up.
 */
export async function loadProvisionalXp(
  opts: LoadProvisionalXpOptions,
): Promise<ProvisionalXp | null> {
  if (provisionalXpRules(opts.progression) === null) return null;
  const attempts = opts.attempts ?? 10;
  const retryMs = opts.retryMs ?? 300;
  const timeoutMs = opts.timeoutMs ?? 5_000;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await wait(retryMs);
    if (opts.signal?.aborted) return null;
    const snapshot = await withTimeout(
      opts.humanStats().catch((err: unknown) => {
        console.warn("provisional XP: no stats from the game", err);
        return null;
      }),
      timeoutMs,
    );
    if (snapshot === null || opts.signal?.aborted) return null;
    const built = buildProvisionalXp({ ...opts, snapshot });
    if (built !== "retry") return built;
  }
  return null;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Why the server's figure differs from the provisional one, where it's known.
export type XpDifference =
  // The team won: a win bonus added.
  | "team_win"
  // Feats are judged on the finished game (only while they pay XP).
  | "feats"
  // The end-of-game vote didn't agree on the game's stats.
  | "unverified"
  // Today's allowances changed meanwhile: a private or singleplayer cap used
  // up (or freed), or the first-game-of-the-day bonus taken by another game
  // (or the game scored on another UTC day).
  | "daily_cap"
  // Anything else.
  | "other";

export interface XpReconciliation {
  // The server's figure is the provisional one.
  matched: boolean;
  differences: XpDifference[];
  // The provisional total, null when the provisional figure was ineligible.
  provisionalTotal: number | null;
  // A difference the end-of-game sources (team win, feats, verification, the
  // daily cap) don't explain: the formula copy may have drifted.
  drift: boolean;
}

export function reconcileXp(
  provisional: XpResult,
  server: GameXpResponse,
): XpReconciliation {
  const provisionalTotal = provisional.eligible
    ? provisional.breakdown.total
    : null;
  const differ = (
    differences: XpDifference[],
    drift = false,
  ): XpReconciliation => ({
    matched: false,
    differences,
    provisionalTotal,
    drift,
  });
  const same: XpReconciliation = {
    matched: true,
    differences: [],
    provisionalTotal,
    drift: false,
  };

  if (!server.eligible) {
    if (!provisional.eligible && provisional.reason === server.reason) {
      return same;
    }
    if (server.reason === "unverified") return differ(["unverified"]);
    if (
      server.reason === "daily_cap" ||
      (!provisional.eligible && provisional.reason === "daily_cap")
    ) {
      return differ(["daily_cap"]);
    }
    return differ(["other"], true);
  }
  if (!provisional.eligible) {
    if (provisional.reason === "daily_cap") return differ(["daily_cap"]);
    return differ(["other"], true);
  }

  const p = provisional.breakdown;
  const s = server.breakdown;
  if (s.total === p.total) return same;
  const differences: XpDifference[] = [];
  if (s.win > p.win) differences.push("team_win");
  if (s.feats > p.feats) differences.push("feats");
  // The first game of the day is known at death (from /users/@me), so it
  // only differs when the day's state changed before the game was scored.
  if (s.firstGame !== p.firstGame) differences.push("daily_cap");
  // The provisional figure with the server's end-of-game lines (and its
  // first-game line) in their place: if that lands on the server's total,
  // nothing else changed.
  const expected = applyMultipliers(
    p.subtotal - endOfGameXp(p) + endOfGameXp(s),
    p.gamePermille,
    p.subscriberPermille,
  );
  const drift = expected !== s.total;
  if (drift) differences.push("other");
  return differ(differences, drift);
}

function endOfGameXp(b: Pick<XpBreakdown, "win" | "firstGame" | "feats">) {
  return b.win + b.firstGame + b.feats;
}
