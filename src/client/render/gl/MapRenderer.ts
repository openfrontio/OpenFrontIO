/**
 * MapRenderer — public facade for the WebGL map renderer.
 *
 * Wraps GPURenderer as a private implementation detail and survives WebGL
 * context loss: when the context is lost the renderer is disposed, and on
 * restore a fresh GPURenderer is created and `onContextRestored` fires so
 * the owner can re-upload all simulation state.
 *
 * This is a pure data sink. Input handling lives in InputHandler/EventBus;
 * camera state is pushed in each frame via setCameraState. Consumers only
 * touch MapRenderer — they never import GPURenderer or Camera.
 */

import type { Config } from "../../../core/configuration/Config";
import type {
  AttackRingInput,
  BonusEvent,
  ConquestFx,
  DeadUnitFx,
  GhostPreviewData,
  NameEntry,
  NukeTelegraphData,
  NukeTrajectoryData,
  PlayerState,
  PlayerStatic,
  PlayerStatusData,
  RendererConfig,
  TilePair,
  UnitState,
} from "../types";
import type { SpawnCenter } from "./passes/SpawnOverlayPass";
import type { AttackTroopLabel } from "./passes/WorldTextPass";
import { GPURenderer } from "./Renderer";
import type { RenderSettings } from "./RenderSettings";

export class MapRenderer {
  private renderer: GPURenderer | null = null;
  private resizeObs: ResizeObserver | null = null;

  /**
   * Called after a lost WebGL context is restored and the renderer has been
   * recreated. The owner must re-upload all simulation state (textures and
   * geometry are gone).
   */
  onContextRestored: (() => void) | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private header: RendererConfig,
    private terrainBytes: Uint8Array,
    private paletteData: Float32Array,
    private config: Config,
    // Resolved render settings (defaults + overrides). Held so the same object
    // is re-used when a GPURenderer is recreated after a context restore,
    // preserving any user overrides that were applied to it.
    private settings: RenderSettings,
    private raf?: typeof requestAnimationFrame,
    private caf?: typeof cancelAnimationFrame,
  ) {
    this.initRenderer();

    this.resizeObs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) this.renderer?.resize(width, height);
      }
    });
    this.resizeObs.observe(canvas);

    canvas.addEventListener("webglcontextlost", this.handleContextLost, false);
    canvas.addEventListener(
      "webglcontextrestored",
      this.handleContextRestored,
      false,
    );
  }

  private initRenderer = () => {
    this.renderer = new GPURenderer(
      this.canvas,
      this.header,
      this.terrainBytes,
      this.paletteData,
      this.config,
      this.settings,
      this.raf,
      this.caf,
    );

    const rect = this.canvas.getBoundingClientRect();
    if (rect.width > 0) this.renderer.resize(rect.width, rect.height);
  };

  private handleContextLost = (e: Event) => {
    e.preventDefault();
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
  };

  private handleContextRestored = () => {
    this.initRenderer();
    this.onContextRestored?.();
  };

  // ---- Camera ----

  setCameraState(x: number, y: number, z: number): void {
    this.renderer?.setCameraState(x, y, z);
  }

  // ---- Data upload ----

  uploadLiveDelta(tileState: Uint16Array, changedTiles: TilePair[]): void {
    this.renderer?.uploadLiveDelta(tileState, changedTiles);
  }
  uploadLiveTrailDelta(
    trailState: Uint8Array,
    dirtyRowMin: number,
    dirtyRowMax: number,
  ): void {
    this.renderer?.uploadLiveTrailDelta(trailState, dirtyRowMin, dirtyRowMax);
  }
  /** Upload full tile + trail state without resetting bloom (for live play). */
  uploadTileAndTrailState(
    tileState: Uint16Array,
    trailState: Uint8Array,
  ): void {
    this.renderer?.uploadTileAndTrailState(tileState, trailState);
  }
  updatePalette(paletteData: Float32Array): void {
    this.renderer?.updatePalette(paletteData);
  }
  addPlayers(
    players: PlayerStatic[],
    paletteData: Float32Array,
    patternMeta: Float32Array,
    patternData: Uint8Array,
  ): void {
    this.renderer?.addPlayers(players, paletteData, patternMeta, patternData);
  }
  setPlayerSkin(smallID: number, url: string): void {
    this.renderer?.setPlayerSkin(smallID, url);
  }
  initSkinAtlas(urls: readonly string[]): void {
    this.renderer?.initSkinAtlas(urls);
  }
  setPlayerSpawn(smallID: number, x: number, y: number): void {
    this.renderer?.setPlayerSpawn(smallID, x, y);
  }
  uploadRailroadState(data: Uint8Array): void {
    this.renderer?.uploadRailroadState(data);
  }
  updateUnits(units: Map<number, UnitState>, gameTick: number): void {
    this.renderer?.updateUnits(units, gameTick);
  }
  updateNames(
    names: Map<string, NameEntry>,
    players: Map<number, PlayerState>,
    snap: boolean,
    statusData?: Map<number, PlayerStatusData>,
  ): void {
    this.renderer?.updateNames(names, players, snap, statusData);
  }
  refreshNames(displayNames: Map<string, string>): void {
    this.renderer?.refreshNames(displayNames);
  }
  updateRelations(data: Uint8Array, size: number): void {
    this.renderer?.updateRelations(data, size);
  }
  updateStructures(units: Map<number, UnitState>): void {
    this.renderer?.updateStructures(units);
  }
  applyDeadUnits(deadUnits: DeadUnitFx[]): void {
    this.renderer?.applyDeadUnits(deadUnits);
  }
  applyConquestEvents(events: ConquestFx[]): void {
    this.renderer?.applyConquestEvents(events);
  }
  setAttackTroopLabels(labels: AttackTroopLabel[]): void {
    this.renderer?.setAttackTroopLabels(labels);
  }
  applyBonusEvents(events: BonusEvent[]): void {
    this.renderer?.applyBonusEvents(events);
  }
  applyRailroadDust(tileRefs: number[]): void {
    this.renderer?.applyRailroadDust(tileRefs);
  }
  /** Refresh terrain texels whose underlying terrain byte changed (water nukes). */
  applyTerrainDelta(refs: readonly number[], terrainBytes: Uint8Array): void {
    this.renderer?.applyTerrainDelta(refs, terrainBytes);
  }

  /** Rebuild the terrain texture from current settings (e.g. ocean color). */
  rebuildTerrain(): void {
    this.renderer?.rebuildTerrain();
  }
  updateAttackRings(rings: AttackRingInput[]): void {
    this.renderer?.updateAttackRings(rings);
  }

  /** Update ghost structure preview (build-mode visualization). null = clear. */
  updateGhostPreview(data: GhostPreviewData | null): void {
    this.renderer?.updateGhostPreview(data);
  }

  // ---- Nuke UI ----

  /** Update nuke trajectory preview arc. null = hide. */
  updateNukeTrajectory(data: NukeTrajectoryData | null): void {
    this.renderer?.updateNukeTrajectory(data);
  }

  /** Update in-flight nuke target telegraph circles. */
  updateNukeTelegraphs(data: NukeTelegraphData[]): void {
    this.renderer?.updateNukeTelegraphs(data);
  }

  /** Update spawn phase overlay (tile highlights + breathing rings). */
  updateSpawnOverlay(inSpawnPhase: boolean, centers: SpawnCenter[]): void {
    this.renderer?.updateSpawnOverlay(inSpawnPhase, centers);
  }

  /** Set the small-player glow set (1 byte per owner smallID), or null = off. */
  updateSmallPlayerGlow(set: Uint8Array | null): void {
    this.renderer?.updateSmallPlayerGlow(set);
  }

  // ---- Selection box ----

  /** Set multiple selected units (multi-select). Pass [] to clear. */
  setSelectedUnits(unitIds: readonly number[]): void {
    this.renderer?.setSelectedUnits(unitIds);
  }

  /** Flash converging-chevron animation at a warship move target. */
  showMoveIndicator(tileX: number, tileY: number, ownerID: number): void {
    this.renderer?.showMoveIndicator(tileX, tileY, ownerID);
  }

  // ---- SAM radius ----

  setSAMAllianceClusters(clusters: Map<number, number>): void {
    this.renderer?.setSAMAllianceClusters(clusters);
  }

  // ---- Other ----

  setLocalPlayerID(id: number): void {
    this.renderer?.setLocalPlayerID(id);
  }
  /** Rail color for the local player (0–1 RGB). */
  setLocalRailColor(r: number, g: number, b: number): void {
    this.renderer?.setLocalRailColor(r, g, b);
  }
  setAltView(active: boolean): void {
    this.renderer?.setAltView(active);
  }
  setGridView(active: boolean): void {
    this.renderer?.setGridView(active);
  }
  setShowPatterns(active: boolean): void {
    this.renderer?.setShowPatterns(active);
  }
  setHighlightOwner(ownerID: number): void {
    this.renderer?.setHighlightOwner(ownerID);
  }
  setMouseWorldPos(x: number, y: number): void {
    this.renderer?.setMouseWorldPos(x, y);
  }
  setHighlightStructureTypes(unitTypes: string[] | null): void {
    this.renderer?.setHighlightStructureTypes(unitTypes);
  }
  getSettings(): RenderSettings {
    return this.renderer?.getSettings() ?? ({} as RenderSettings);
  }

  // ---- Lifecycle ----

  dispose(): void {
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    this.onContextRestored = null;
    this.renderer?.dispose();
    this.canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    this.canvas.removeEventListener(
      "webglcontextrestored",
      this.handleContextRestored,
    );
  }
}
