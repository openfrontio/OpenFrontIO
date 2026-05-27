/**
 * GameView — public facade for the openfront-gl renderer.
 *
 * Wraps GPURenderer (rendering) and Camera (viewport math) as private
 * implementation details. Handles all user interaction: drag-to-pan,
 * wheel-to-zoom, click detection, hover tracking, and hit-testing.
 *
 * Consumers only touch GameView — they never import GPURenderer or Camera.
 */

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
import type {
  GameViewEventMap,
  GameViewEventType,
  RadialMenuItem,
} from "./Events";
import type { SpawnCenter } from "./passes/SpawnOverlayPass";
import type { AttackTroopLabel } from "./passes/WorldTextPass";
import { GPURenderer } from "./Renderer";
import type { RenderSettings } from "./RenderSettings";

export class GameView {
  private renderer: GPURenderer | null = null;
  private resizeObs: ResizeObserver | null = null;

  private listeners = new Map<string, Set<(e: unknown) => void>>();
  private cachedIcons: { key: string; img: CanvasImageSource }[] = [];

  // Stored for context recreation
  private cachedOnFrame: ((ms: number) => void) | null = null;
  private cachedAfterRender: ((canvas: HTMLCanvasElement) => void) | null =
    null;

  constructor(
    private canvas: HTMLCanvasElement,
    private header: RendererConfig,
    private terrainBytes: Uint8Array,
    private paletteData: Float32Array,
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

    canvas.addEventListener("webglcontextlost", this.onContextLost, false);
    canvas.addEventListener(
      "webglcontextrestored",
      this.onContextRestored,
      false,
    );
  }

  private initRenderer = () => {
    this.renderer = new GPURenderer(
      this.canvas,
      this.header,
      this.terrainBytes,
      this.paletteData,
      this.raf,
      this.caf,
    );

    // Restore cached state
    if (this.cachedIcons.length > 0) {
      this.renderer.registerRadialMenuIcons(this.cachedIcons);
    }
    this.renderer.onFrame = this.cachedOnFrame;
    this.renderer.afterRender = this.cachedAfterRender;

    const rect = this.canvas.getBoundingClientRect();
    if (rect.width > 0) this.renderer.resize(rect.width, rect.height);
  };

  private onContextLost = (e: Event) => {
    e.preventDefault();
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
  };

  private onContextRestored = () => {
    this.initRenderer();
    this.emit("contextrestored", { type: "restored" });
  };

  // ---- Event system ----

  on<K extends GameViewEventType>(
    event: K,
    handler: (e: GameViewEventMap[K]) => void,
  ): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as (e: unknown) => void);
  }

  off<K extends GameViewEventType>(
    event: K,
    handler: (e: GameViewEventMap[K]) => void,
  ): void {
    this.listeners.get(event)?.delete(handler as (e: unknown) => void);
  }

  private emit<K extends GameViewEventType>(
    event: K,
    data: GameViewEventMap[K],
  ): void {
    const set = this.listeners.get(event);
    if (set)
      for (const fn of set) (fn as (e: GameViewEventMap[K]) => void)(data);
  }

  // ---- Radial menu ----

  showRadialMenu(
    screenX: number,
    screenY: number,
    items: RadialMenuItem[],
    centerItem?: RadialMenuItem,
  ): void {
    this.renderer?.showRadialMenu(screenX, screenY, items, centerItem);
  }

  hideRadialMenu(): void {
    this.renderer?.hideRadialMenu();
  }

  openRadialSubMenu(subItems: RadialMenuItem[]): void {
    this.renderer?.openRadialSubMenu(subItems);
  }

  goBackRadialMenu(): void {
    this.renderer?.goBackRadialMenu();
  }

  get radialMenuVisible(): boolean {
    return this.renderer?.radialMenuVisible ?? false;
  }
  registerRadialMenuIcons(
    icons: { key: string; img: CanvasImageSource }[],
  ): void {
    this.cachedIcons = icons;
    this.renderer?.registerRadialMenuIcons(icons);
  }

  // ---- Camera ----

  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return this.renderer?.screenToWorld(screenX, screenY) ?? { x: 0, y: 0 };
  }

  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    return this.renderer?.worldToScreen(worldX, worldY) ?? { x: 0, y: 0 };
  }

  panTo(worldX: number, worldY: number): void {
    this.renderer?.panTo(worldX, worldY);
  }
  zoomTo(level: number): void {
    this.renderer?.zoomTo(level);
  }
  fitMap(): void {
    this.renderer?.fitMap();
  }
  focusOwner(ownerID: number): void {
    this.renderer?.focusOwner(ownerID);
  }

  focusBBox(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    padding?: number,
  ): void {
    this.renderer?.focusBBox(minX, minY, maxX, maxY, padding);
  }

  getCameraState(): { x: number; y: number; z: number } {
    return this.renderer?.getCameraState() ?? { x: 0, y: 0, z: 1 };
  }

  setCameraState(x: number, y: number, z: number): void {
    this.renderer?.setCameraState(x, y, z);
  }

  getOwnerAtWorld(worldX: number, worldY: number): number {
    return this.renderer?.getOwnerAtWorld(worldX, worldY) ?? 0;
  }

  // ---- Data upload ----

  applyFullFrame(
    tileState: Uint16Array,
    trailState: Uint8Array,
    nukeEvents?: Array<{ tick: number; tiles: number[] }>,
    currentTick?: number,
  ): void {
    this.renderer?.applyFullFrame(
      tileState,
      trailState,
      nukeEvents,
      currentTick,
    );
  }

  applyFullTiles(tileState: Uint16Array, trailState: Uint8Array): void {
    this.renderer?.applyFullTiles(tileState, trailState);
  }
  applyDelta(changedTiles: TilePair[], trailState: Uint8Array): void {
    this.renderer?.applyDelta(changedTiles, trailState);
  }
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
  updateAttackRings(rings: AttackRingInput[]): void {
    this.renderer?.updateAttackRings(rings);
  }
  clearFx(): void {
    this.renderer?.clearFx();
  }
  setFxTimeFn(fn: () => number): void {
    this.renderer?.setFxTimeFn(fn);
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

  // ---- Selection box ----

  /** Show/hide the stippled selection box around a unit (warship selection). */
  setSelectedUnit(unitId: number | null): void {
    this.renderer?.setSelectedUnit(unitId);
  }

  /** Set multiple selected units (multi-select). Pass [] to clear. */
  setSelectedUnits(unitIds: readonly number[]): void {
    this.renderer?.setSelectedUnits(unitIds);
  }

  /** Flash converging-chevron animation at a warship move target. */
  showMoveIndicator(tileX: number, tileY: number, ownerID: number): void {
    this.renderer?.showMoveIndicator(tileX, tileY, ownerID);
  }

  // ---- SAM radius (replay) ----

  setSAMRadiusVisible(visible: boolean): void {
    this.renderer?.setSAMRadiusVisible(visible);
  }
  setSAMPerspective(playerID: number, allies: Set<number>): void {
    this.renderer?.setSAMPerspective(playerID, allies);
  }
  setSAMColorMode(mode: "perspective" | "owner"): void {
    this.renderer?.setSAMColorMode(mode);
  }
  setSAMAllianceClusters(clusters: Map<number, number>): void {
    this.renderer?.setSAMAllianceClusters(clusters);
  }

  // ---- Other ----

  setLocalPlayerID(id: number): void {
    this.renderer?.setLocalPlayerID(id);
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
  setHighlightStructureTypes(unitTypes: string[] | null): void {
    this.renderer?.setHighlightStructureTypes(unitTypes);
  }
  getSettings(): RenderSettings {
    return this.renderer?.getSettings() ?? ({} as RenderSettings);
  }
  get fps(): number {
    return this.renderer?.fps ?? 0;
  }
  set onFrame(cb: ((ms: number) => void) | null) {
    this.cachedOnFrame = cb;
    if (this.renderer) this.renderer.onFrame = cb;
  }
  set afterRender(cb: ((canvas: HTMLCanvasElement) => void) | null) {
    this.cachedAfterRender = cb;
    if (this.renderer) this.renderer.afterRender = cb;
  }

  // ---- Lifecycle ----

  dispose(): void {
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    this.listeners.clear();
    this.renderer?.dispose();
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.canvas.removeEventListener(
      "webglcontextrestored",
      this.onContextRestored,
    );
  }
}
