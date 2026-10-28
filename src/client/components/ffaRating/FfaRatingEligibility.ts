import {
  GameMode,
  GameType,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import type { PublicGameType } from "@openfront/shared/WireSchemas";
import type { GameView } from "../../view";

// Pure and light (types and engine-api enums only): the win screen imports it
// statically and loads the panel itself only once this says there is one.

/** A game whose rating the win screen may show. */
export interface FfaRatingGame {
  gameId: string;
  /** Humans who spawned: the panel applies the rated-lobby floor itself. */
  lobbyHumans: number;
}

/**
 * The game as an FFA rating candidate: a public, unranked FFA game that filled
 * the plain FFA lobby slot and that the viewer played (not a replay, not as a
 * spectator, and spawned in). null for anything else.
 *
 * `publicGameType` is the slot from the lobby info. Special lobbies are FFA
 * too but never rated, and the game config can't tell them apart, so an
 * unknown slot (a tab that never saw the lobby) counts as not rated: the panel
 * would otherwise poll a 404 for its whole timeout.
 */
export function ffaRatingGameOf(
  game: Pick<GameView, "config" | "myPlayer" | "players" | "gameID">,
  publicGameType: PublicGameType | undefined,
): FfaRatingGame | null {
  const config = game.config();
  const { gameType, gameMode, rankedType } = config.gameConfig();
  if (
    publicGameType !== "ffa" ||
    gameType !== GameType.Public ||
    gameMode !== GameMode.FFA ||
    rankedType !== undefined ||
    config.isReplay() ||
    game.myPlayer()?.hasSpawned() !== true
  ) {
    return null;
  }
  const lobbyHumans = game
    .players()
    .filter((p) => p.type() === PlayerType.Human && p.hasSpawned()).length;
  return { gameId: game.gameID(), lobbyHumans };
}

/**
 * Whether the viewer can have a rating to show. The API sends `tier` or
 * `calibrationGames` only once the rating is live (before that, `@me`
 * carries the frozen Elo alone), so without them the panel would poll a 404
 * for its whole timeout. Trust doesn't matter here: every signed-in account
 * is rated, and trust only decides who is listed on the leaderboard.
 */
export function viewerHasFfaRating(me: UserMeResponse): boolean {
  const ffa = me.player.leaderboard?.ffa;
  return ffa?.tier !== undefined || ffa?.calibrationGames !== undefined;
}
