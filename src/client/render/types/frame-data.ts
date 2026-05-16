import type { FrameEvents } from "./frame-events";
import type {
  AttackRingInput,
  NameEntry,
  NukeTelegraphData,
  PlayerState,
  PlayerStatusData,
  TilePair,
  UnitState,
} from "./renderer";

/**
 * FrameData — the boundary contract between game integration and features.
 *
 * Produced once per frame by a driver (shim for live, codec for replay).
 * All feature consumers (renderer, minimap, stats) read from this interface.
 * They never touch game internals directly.
 */
export interface FrameData {
  // ── Core accumulated state ────────────────────────────────────────────

  readonly tick: number;
  /** True during spawn phase (before gameplay begins). Always false for replay. */
  readonly inSpawnPhase: boolean;
  readonly tileState: Uint16Array;
  readonly trailState: Uint8Array;
  readonly railroadState: Uint8Array;
  readonly units: ReadonlyMap<number, UnitState>;
  readonly players: ReadonlyMap<number, PlayerState>;
  readonly names: ReadonlyMap<string, NameEntry>;

  // ── Per-frame events ──────────────────────────────────────────────────

  /** Everything that happened this frame — rendering FX and stats events. */
  readonly events: FrameEvents;

  // ── Upload hints ──────────────────────────────────────────────────────

  /**
   * Changed tiles this frame for delta uploads.
   * - `null` or `undefined` → full upload needed (live mode or keyframe seek)
   * - array → delta upload (replay sequential advance)
   */
  readonly changedTiles?: TilePair[] | null;
  readonly railroadDirty: boolean;
  readonly revealedRailTiles: number[];

  /**
   * Trail dirty row range for partial GPU upload.
   * - `dirtyRowMin > dirtyRowMax` → no trail changes (skip upload)
   * - Otherwise → upload rows [min, max] from trailState
   * Only meaningful in `tileMode: "live"`.
   */
  readonly trailDirtyRowMin: number;
  readonly trailDirtyRowMax: number;

  // ── Derived (computed once by producer) ────────────────────────────────

  readonly playerStatus: ReadonlyMap<number, PlayerStatusData>;
  readonly relationMatrix: Uint8Array;
  readonly relationSize: number;
  readonly allianceClusters: ReadonlyMap<number, number>;
  readonly nukeTelegraphs: NukeTelegraphData[];
  readonly attackRings: AttackRingInput[];
  /** True when structures changed this tick (added/removed/level change). */
  readonly structuresDirty: boolean;

  // ── Upload semantics ──────────────────────────────────────────────────

  /**
   * How tile data should reach the GPU:
   * - `"live"` — arrays are mutated in-place by shim each tick (zero-copy refs)
   * - `"copy"` — arrays may be swapped/reconstructed (renderer must copy)
   */
  readonly tileMode: "live" | "copy";
}
