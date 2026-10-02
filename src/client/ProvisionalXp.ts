import type { XpRules } from "../core/ApiSchemas";
import { GameMode, GameType, HumansVsNations } from "../core/game/Game";
import {
  ATTACK_INDEX_SENT,
  BOAT_INDEX_SENT,
  OTHER_INDEX_BUILT,
  type PlayerStats,
} from "../core/StatsSchemas";

// A copy of the API's XP formula (computeXp in the API's
// lib/progression/Xp.ts), for the PROVISIONAL figure shown when a player dies
// before the game ends. Display only: nothing here is sent anywhere, and the
// server's number, polled once the game ends, always replaces it.
//
// The copy must stay exact, integer for integer: the API names the formula's
// revision in GET /public/progression/config (`formula`), and the client shows
// no provisional figure for a revision other than this one. The reference
// cases the API generates (tests/testdata/progression/xp-reference-cases.json)
// pin it.
export const PROVISIONAL_XP_FORMULA = 1;

// The game runs at 10 ticks per second.
const TICKS_PER_MINUTE = 600;

// The game settings the formula reads. A subset of the archived record's
// config, which is the game's own GameConfig.
export interface XpGameConfig {
  gameType: GameType;
  gameMode: GameMode;
  rankedType?: string;
  playerTeams?: unknown;
  infiniteGold: boolean;
  infiniteTroops: boolean;
  instantBuild: boolean;
  startingGold?: number | null;
  goldMultiplier?: number | null;
  hostCheats?: unknown;
}

// What a player has already used of their per-UTC-day allowances, before the
// game being scored.
export interface DailyXpState {
  privateGames: number;
  singleplayerGames: number;
  firstGameClaimed: boolean;
}

export const NO_DAILY_XP: DailyXpState = {
  privateGames: 0,
  singleplayerGames: 0,
  firstGameClaimed: false,
};

// Everything computeXp reads about one player in one game.
export interface XpContext {
  config: XpGameConfig;
  // Missing for a player who never spawned.
  stats: PlayerStats;
  // The tick the player left for good, or null if they never left.
  leftAtTick: number | null;
  isWinner: boolean;
  // The game's length in ticks.
  ticks: number;
  // People who spawned: the lobby-size measure.
  spawnedHumans: number;
  // FFA only: other spawned humans this player outlasted.
  opponentsOutlasted: number;
  // Per-game feats earned.
  featCount: number;
  daily: DailyXpState;
  // The player's subscription tier multiplier; 1000 = none.
  subscriberPermille: number;
}

export type XpIneligibleReason =
  | "not_spawned"
  | "too_short"
  | "no_action"
  | "custom_settings"
  | "too_few_humans"
  | "daily_cap";

export interface XpBreakdown {
  leftEarly: boolean;
  played: number;
  time: number;
  placement: number;
  win: number;
  firstGame: number;
  feats: number;
  subtotal: number;
  gamePermille: number;
  subscriberPermille: number;
  total: number;
}

export type XpResult =
  | { eligible: false; reason: XpIneligibleReason }
  | { eligible: true; breakdown: XpBreakdown; daily: DailyXpState };

export function computeXp(ctx: XpContext, rules: XpRules): XpResult {
  const { config, stats } = ctx;
  if (stats === undefined) return ineligible("not_spawned");

  // Out of the game at the earliest of elimination, leaving and the end.
  const eliminatedAt = Math.min(
    stats.killedAt === undefined ? ctx.ticks : Number(stats.killedAt),
    ctx.ticks,
  );
  const leftEarly = ctx.leftAtTick !== null && ctx.leftAtTick < eliminatedAt;
  const aliveTicks = leftEarly ? ctx.leftAtTick! : eliminatedAt;
  if (aliveTicks < rules.minAliveTicks) return ineligible("too_short");
  if (!tookAction(stats)) return ineligible("no_action");

  const isPrivate = config.gameType === GameType.Private;
  const isSingleplayer = config.gameType === GameType.Singleplayer;
  if ((isPrivate || isSingleplayer) && hasCustomSettings(config)) {
    return ineligible("custom_settings");
  }
  if (isPrivate && ctx.spawnedHumans < rules.privateMinHumans) {
    return ineligible("too_few_humans");
  }
  if (
    (isPrivate && ctx.daily.privateGames >= rules.privateGamesPerDay) ||
    (isSingleplayer &&
      ctx.daily.singleplayerGames >= rules.singleplayerGamesPerDay)
  ) {
    return ineligible("daily_cap");
  }

  const time = Math.floor(
    (Math.min(aliveTicks, rules.timeCapMinutes * TICKS_PER_MINUTE) *
      rules.xpPerMinute) /
      TICKS_PER_MINUTE,
  );

  const isFfa = config.gameMode === GameMode.FFA;
  const isHvn = config.playerTeams === HumansVsNations;
  // min(1, humans / fullLobbyHumans), kept as a fraction.
  const lobbyNum = Math.min(ctx.spawnedHumans, rules.fullLobbyHumans);
  const lobbyDen = rules.fullLobbyHumans;

  const opponents = ctx.spawnedHumans - 1;
  const placement =
    isFfa && opponents > 0 && !leftEarly
      ? Math.floor(
          (rules.ffaPlacementMax *
            Math.min(ctx.opponentsOutlasted, opponents) *
            lobbyNum) /
            (opponents * lobbyDen),
        )
      : 0;

  const wonGame = ctx.isWinner && !leftEarly;
  let win = 0;
  if (wonGame) {
    if (isFfa) {
      win = Math.floor((rules.ffaWin * lobbyNum) / lobbyDen);
    } else if (isHvn) {
      win = rules.hvnWin;
    } else if (aliveTicks * 1000 >= ctx.ticks * rules.teamWinMinAlivePermille) {
      win = rules.teamWin;
    }
  }

  // The player's first public game of the UTC day (ranked included), won or
  // lost, pays a flat bonus, not scaled by the lobby. Private and
  // singleplayer games neither pay it nor use it up, and nor does a game the
  // player left early.
  const firstGame =
    config.gameType === GameType.Public &&
    !leftEarly &&
    !ctx.daily.firstGameClaimed
      ? rules.firstGameOfDay
      : 0;
  // Zero while the rules pay nothing for a feat (featXp 0).
  const feats =
    Math.min(Math.max(ctx.featCount, 0), rules.maxFeatsPerGame) * rules.featXp;

  const played = leftEarly ? 0 : rules.gameXp;
  const subtotal = played + time + placement + win + firstGame + feats;
  const gamePermille = gameMultiplier(config, rules);
  const total = applyMultipliers(
    subtotal,
    gamePermille,
    ctx.subscriberPermille,
  );

  return {
    eligible: true,
    breakdown: {
      leftEarly,
      played,
      time,
      placement,
      win,
      firstGame,
      feats,
      subtotal,
      gamePermille,
      subscriberPermille: ctx.subscriberPermille,
      total,
    },
    daily: {
      privateGames: ctx.daily.privateGames + (isPrivate ? 1 : 0),
      singleplayerGames: ctx.daily.singleplayerGames + (isSingleplayer ? 1 : 0),
      firstGameClaimed: ctx.daily.firstGameClaimed || firstGame > 0,
    },
  };
}

/** The award for a subtotal: both multipliers, rounded half up. */
export function applyMultipliers(
  subtotal: number,
  gamePermille: number,
  subscriberPermille: number,
): number {
  const scale = 1000 * 1000;
  return Math.floor(
    (subtotal * gamePermille * subscriberPermille + scale / 2) / scale,
  );
}

// For each spawned player in an FFA game, how many other spawned players went
// out strictly before them. Survivors outlast every eliminated player and tie
// with each other. `hasFinalTiles` is whether the stats carry end-of-game tile
// counts (only a finished game's do): then a player with neither killedAt nor
// finalTiles went out on the final tick. A player who left goes out when they
// left (`leftAt`, clientID -> tick).
export function ffaOutlasted(
  players: readonly { clientID: string; stats: PlayerStats }[],
  ticks: number,
  leftAt: ReadonlyMap<string, number> = new Map(),
): Map<string, number> {
  const hasFinalTiles = players.some(
    ({ stats }) => stats?.finalTiles !== undefined,
  );
  const outAt = new Map<string, number>();
  for (const { clientID, stats } of players) {
    if (stats === undefined) continue;
    let out: number;
    if (stats.killedAt !== undefined) {
      out = Math.min(Number(stats.killedAt), ticks);
    } else if (!hasFinalTiles || (stats.finalTiles ?? 0n) > 0n) {
      out = Infinity;
    } else {
      out = ticks;
    }
    const left = leftAt.get(clientID);
    if (left !== undefined) out = Math.min(out, left);
    outAt.set(clientID, out);
  }

  const outlasted = new Map<string, number>();
  for (const [clientID, out] of outAt) {
    let count = 0;
    for (const [other, otherOut] of outAt) {
      if (other !== clientID && otherOut < out) count++;
    }
    outlasted.set(clientID, count);
  }
  return outlasted;
}

// At least one attack sent, structure built, conquest, or transport launched.
function tookAction(stats: NonNullable<PlayerStats>): boolean {
  if ((stats.attacks?.[ATTACK_INDEX_SENT] ?? 0n) > 0n) return true;
  if ((stats.boats?.trans?.[BOAT_INDEX_SENT] ?? 0n) > 0n) return true;
  for (const counts of Object.values(stats.units ?? {})) {
    if ((counts?.[OTHER_INDEX_BUILT] ?? 0n) > 0n) return true;
  }
  // Archived records once held a single conquest count.
  const conquests: unknown = stats.conquests;
  if (typeof conquests === "bigint") return conquests > 0n;
  return ((conquests as bigint[] | undefined) ?? []).some((n) => n > 0n);
}

// The lobby changed starting gold or the gold multiplier from the game's
// defaults (0 and 1). Read with typeof: the game sends null for a setting the
// host switched off.
function hasCustomGold(config: XpGameConfig): boolean {
  const { startingGold, goldMultiplier } = config;
  return (
    (typeof startingGold === "number" && startingGold !== 0) ||
    (typeof goldMultiplier === "number" && goldMultiplier !== 1)
  );
}

// Anything a private host or a singleplayer client can turn on to make the
// game easier. Host cheats count when they grant anything.
function hasCustomSettings(config: XpGameConfig): boolean {
  if (config.infiniteGold || config.infiniteTroops || config.instantBuild) {
    return true;
  }
  if (hasCustomGold(config)) return true;
  const hostCheats: unknown = config.hostCheats;
  if (typeof hostCheats !== "object" || hostCheats === null) return false;
  const { infiniteGold, infiniteTroops, goldMultiplier, startingGold } =
    hostCheats as Record<string, unknown>;
  return (
    infiniteGold === true ||
    infiniteTroops === true ||
    typeof goldMultiplier === "number" ||
    typeof startingGold === "number"
  );
}

function gameMultiplier(config: XpGameConfig, rules: XpRules): number {
  switch (config.gameType) {
    case GameType.Public:
      // Ranked is a public game with rankedType set.
      return config.rankedType !== undefined
        ? rules.rankedPermille
        : rules.publicPermille;
    case GameType.Private:
      return rules.privatePermille;
    case GameType.Singleplayer:
      return rules.singleplayerPermille;
  }
}

function ineligible(reason: XpIneligibleReason): XpResult {
  return { eligible: false, reason };
}
