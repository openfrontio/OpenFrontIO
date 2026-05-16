import type { FrameData } from "./frame-data";
import type { PlayerStatic } from "./renderer";

/**
 * Static per-session metadata. Set once at game-start, never changes.
 */
export interface GameStartConfig {
  gameID: string;
  mapWidth: number;
  mapHeight: number;
  /** 0 for spectator/replay. */
  localPlayerSmallID: number;
  players: PlayerStatic[];
  gameMode?: string;
  difficulty?: string;
  numLandTiles?: number;
}

/**
 * Mode-agnostic frame source. Features subscribe here and don't care
 * whether data comes from a live game or a replay file.
 *
 * All subscription methods return an unsubscribe function.
 *
 * Late-join: `onGameStart` fires immediately with cached config if
 * subscribed after game-start. `onFrame` does NOT late-fire — subscriber
 * waits for the next real tick.
 *
 * Game-end: `onGameEnd` fires on win detection. `onFrame` continues
 * emitting — the simulation runs past game-end.
 */
export interface FrameSource {
  onFrame(handler: (frame: FrameData) => void): () => void;
  onGameStart(handler: (config: GameStartConfig) => void): () => void;
  onGameEnd(handler: () => void): () => void;
  /** null before game-start. Stays valid after game-end (same session). */
  readonly config: GameStartConfig | null;
}
