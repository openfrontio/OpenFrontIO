import { AllPlayersStats, ClientID } from "../Schemas";
import { Game, PlayerType } from "./Game";

/**
 * The humans' stats as they stand right now, for the client's provisional XP
 * figure (src/client/ProvisionalXp.ts): the player's own XP is scored from
 * the same per-player stats the end-of-game record carries, and in FFA from
 * who went out before them. Read-only: nothing here touches the simulation.
 */
export interface HumanStatsSnapshot {
  // The tick the snapshot was taken at.
  tick: number;
  // Every human's stats, keyed by clientID: the object the archived record
  // carries per player (players who never spawned have none).
  stats: AllPlayersStats;
  // Humans whose connection is currently marked lost: clientID -> the tick
  // it was. The API reads a player who never came back as having left then.
  disconnectedAt: Record<ClientID, number>;
}

export function humanStatsSnapshot(game: Game): HumanStatsSnapshot {
  const disconnectedAt: Record<ClientID, number> = {};
  for (const player of game.allPlayers()) {
    const clientID = player.clientID();
    if (player.type() !== PlayerType.Human || clientID === null) continue;
    if (!player.isDisconnected()) continue;
    const tick = player.disconnectedAtTick();
    if (tick !== null) disconnectedAt[clientID] = tick;
  }
  return {
    tick: game.ticks(),
    // A copy: the live object keeps changing as the game runs.
    stats: structuredClone(game.stats().stats()),
    disconnectedAt,
  };
}
