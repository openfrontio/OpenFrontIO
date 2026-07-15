import type { ConquestFx, DeadUnitFx } from "./Renderer";

// ── Supporting event types ──────────────────────────────────────────────

export interface BonusEvent {
  playerID: string;
  smallID: number;
  tile: number;
  gold: number;
  troops: number;
}

// ── FrameEvents ─────────────────────────────────────────────────────────

/**
 * Everything that happened THIS frame. Accumulated state and derived data
 * live on FrameData directly — per-frame ephemeral events live here.
 *
 * Empty arrays when nothing happened. Producers must always populate every
 * field (no undefined — consumers shouldn't need null checks).
 */
export interface FrameEvents {
  readonly deadUnits: DeadUnitFx[];
  readonly conquestEvents: ConquestFx[];
  readonly bonusEvents: BonusEvent[];
}
