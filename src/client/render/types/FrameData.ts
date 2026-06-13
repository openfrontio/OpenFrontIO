import type { FrameEvents } from "./FrameEvents";
import type {
  AttackRingInput,
  NameEntry,
  NukeTelegraphData,
  PlayerState,
  PlayerStatusData,
  TilePair,
  UnitState,
} from "./Renderer";

/**
 * FrameData — the boundary contract between game integration and the
 * renderer. Built once per tick by GameView; the renderer reads from this
 * interface and never touches game internals directly.
 *
 * Arrays are long-lived and mutated in place each tick (zero-copy refs).
 */
export interface FrameData {
  // ── Core accumulated state ────────────────────────────────────────────

  readonly tick: number;
  /** True during spawn phase (before gameplay begins). */
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
   * - `null` → no delta info; full upload needed (first tick)
   * - array → only these tiles changed (empty = skip upload)
   */
  readonly changedTiles: TilePair[] | null;
  readonly railroadDirty: boolean;
  readonly revealedRailTiles: number[];

  /**
   * Trail dirty row range for partial GPU upload.
   * - `dirtyRowMin > dirtyRowMax` → no trail changes (skip upload)
   * - Otherwise → upload rows [min, max] from trailState
   */
  readonly trailDirtyRowMin: number;
  readonly trailDirtyRowMax: number;

  // ── Derived (computed once by producer) ────────────────────────────────

  readonly playerStatus: ReadonlyMap<number, PlayerStatusData>;
  readonly relationMatrix: Uint8Array;
  readonly relationSize: number;
  /**
   * True when relationMatrix was rebuilt this tick (alliance/embargo change).
   * Consumers skip the GPU upload — and the full-map border recompute it
   * triggers — when false.
   */
  readonly relationsDirty: boolean;
  readonly allianceClusters: ReadonlyMap<number, number>;
  readonly nukeTelegraphs: NukeTelegraphData[];
  readonly attackRings: AttackRingInput[];
  /** True when structures changed this tick (added/removed/level change). */
  readonly structuresDirty: boolean;
}
