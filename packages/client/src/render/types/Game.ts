/**
 * The frame data type that both the live game and encoder consume.
 * This matches the GameUpdateViewData from the live game's update loop.
 */
export interface GameUpdateViewData {
  tick: number;
  updates: Record<string, unknown[]>;
  packedTileUpdates: unknown;
  packedMotionPlans?: Uint32Array;
  playerNameViewData: Record<string, { x: number; y: number; size: number }>;
}

/**
 * Minimal GameStartInfo for the encoder's finish() call.
 * The actual object is opaque JSON — we just need it to be serializable.
 */
export type GameStartInfo = Record<string, unknown>;
