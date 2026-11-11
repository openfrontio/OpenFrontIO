import type { GameView } from "../view";

export interface EndScreenStats {
  /** Whole seconds since the spawn phase ended. */
  seconds: number;
  /**
   * The share of the land that can still be owned, 0..1: mine, or my team's
   * in a team game. Null when I am not a player, or when I am dead outside a
   * team game (it would be 0%).
   */
  landShare: number | null;
  /**
   * My rank, 1 = first: among all players, or among my teammates in a team
   * game. Null when I am not a player.
   */
  rank: number | null;
  /** What `rank` is out of: the players, or my teammates, who spawned. */
  players: number;
  /** True when the figures are my team's: its land, my rank within it. */
  team: boolean;
}

/**
 * The figures the end screen shows under its title. Null during the spawn
 * phase: a match cancelled before it started has nothing to show.
 */
export function endScreenStats(game: GameView): EndScreenStats | null {
  if (game.inSpawnPhase()) return null;
  const seconds = Math.floor(game.elapsedGameSeconds());
  const me = game.myPlayer();
  const mine = me !== null && me.hasSpawned() ? me : null;
  // In a team game the team is what won or lost, so the figures are about it.
  const myTeam = mine?.team() ?? null;

  // Dead players stay in playerViews(), so this counts everyone who took part.
  // Counting instead of sorting keeps the rank independent of the list's
  // order, and players tied on land share the better rank.
  let players = 0;
  let ahead = 0;
  let tiles = 0;
  for (const p of game.playerViews()) {
    if (!p.hasSpawned()) continue;
    if (myTeam !== null && p.team() !== myTeam) continue;
    players++;
    tiles += p.numTilesOwned();
    if (mine === null || p === mine) continue;
    if (mine.isAlive()) {
      if (p.numTilesOwned() > mine.numTilesOwned()) ahead++;
    } else if (p.isAlive()) {
      // Everyone still alive outlasted me.
      ahead++;
    }
  }

  if (mine === null) {
    return { seconds, landShare: null, rank: null, players, team: false };
  }
  // The leaderboard's "Owned" column: land that fallout has not taken.
  const land = game.numLandTiles() - game.numTilesWithFallout();
  const share = (owned: number) => (land > 0 ? owned / land : 0);
  if (myTeam !== null) {
    return {
      seconds,
      landShare: share(tiles),
      rank: ahead + 1,
      players,
      team: true,
    };
  }
  return {
    seconds,
    landShare: mine.isAlive() ? share(mine.numTilesOwned()) : null,
    rank: ahead + 1,
    players,
    team: false,
  };
}
