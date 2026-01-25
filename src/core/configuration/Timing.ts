import { GameType } from "../game/Game";

export const TICKS_PER_SECOND = 10;
export const SPAWN_PHASE_TICKS = {
  singleplayer: 100,
  multiplayer: 300,
} as const;

export type GameTypeLike = GameType | string | undefined;

export function spawnPhaseTurns(gameType: GameTypeLike): number {
  return gameType === GameType.Singleplayer
    ? SPAWN_PHASE_TICKS.singleplayer
    : SPAWN_PHASE_TICKS.multiplayer;
}

export function spawnPhaseSeconds(gameType: GameTypeLike): number {
  return spawnPhaseTurns(gameType) / TICKS_PER_SECOND;
}
