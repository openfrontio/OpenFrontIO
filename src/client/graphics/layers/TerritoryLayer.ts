import { Theme } from "../../../core/configuration/Config";
import { EventBus } from "../../../core/EventBus";
import { UnitType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { AlternateViewEvent, MouseOverEvent } from "../../InputHandler";
import { FrameProfiler } from "../FrameProfiler";
import { TransformHandler } from "../TransformHandler";
import { TerritoryRenderer } from "../webgpu/TerritoryRenderer";
import { Layer } from "./Layer";

export class TerritoryLayer implements Layer {
  profileName(): string {
    return "TerritoryLayer:renderLayer";
  }

  private attachedTerritoryCanvas: HTMLCanvasElement | null = null;

  private overlayWrapper: HTMLElement | null = null;
  private overlayResizeObserver: ResizeObserver | null = null;

  private theme: Theme;

  private territoryRenderer: TerritoryRenderer | null = null;
  private alternativeView = false;

  private lastPaletteSignature: string | null = null;
  private lastDefensePostsSignature: string | null = null;

  private lastMousePosition: { x: number; y: number } | null = null;
  private hoveredOwnerSmallId: number | null = null;
  private lastHoverUpdateMs = 0;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transformHandler: TransformHandler,
    private userSettings: UserSettings,
  ) {
    this.theme = game.config().theme();
  }

  shouldTransform(): boolean {
    return true;
  }

  init() {
    this.eventBus.on(AlternateViewEvent, (e) => {
      this.alternativeView = e.alternateView;
      this.territoryRenderer?.setAlternativeView(this.alternativeView);
    });
    this.eventBus.on(MouseOverEvent, (e) => {
      this.lastMousePosition = { x: e.x, y: e.y };
    });
    this.redraw();
  }

  tick() {
    const tickProfile = FrameProfiler.start();

    const currentTheme = this.game.config().theme();
    if (currentTheme !== this.theme) {
      this.theme = currentTheme;
      this.redraw();
    }

    this.refreshPaletteIfNeeded();
    this.refreshDefensePostsIfNeeded();

    const updatedTiles = this.game.recentlyUpdatedTiles();
    for (let i = 0; i < updatedTiles.length; i++) {
      this.markTile(updatedTiles[i]);
    }

    // After collecting pending updates and handling palette/theme changes,
    // invoke the renderer's tick() to process compute passes. This ensures
    // compute shaders run at the simulation rate rather than every frame.
    this.territoryRenderer?.tick();

    FrameProfiler.end("TerritoryLayer:tick", tickProfile);
  }

  redraw() {
    this.configureRenderer();
  }

  private configureRenderer() {
    const { renderer, reason } = TerritoryRenderer.create(
      this.game,
      this.theme,
    );
    if (!renderer) {
      throw new Error(reason ?? "WebGPU is required for territory rendering.");
    }

    this.territoryRenderer = renderer;
    this.territoryRenderer.setAlternativeView(this.alternativeView);
    this.territoryRenderer.setHighlightedOwnerId(this.hoveredOwnerSmallId);
    this.territoryRenderer.markAllDirty();
    this.territoryRenderer.refreshPalette();
    this.lastPaletteSignature = this.computePaletteSignature();

    this.lastDefensePostsSignature = this.computeDefensePostsSignature();
    // Ensure defense posts buffer is uploaded on first tick.
    this.territoryRenderer.markDefensePostsDirty();

    // Run an initial tick to upload state and build the colour texture. Without
    // this, the first render call may occur before the initial compute pass
    // has been executed, resulting in undefined colours.
    this.territoryRenderer.tick();
  }

  renderLayer(context: CanvasRenderingContext2D) {
    if (!this.territoryRenderer) {
      return;
    }

    this.ensureTerritoryCanvasAttached(context.canvas);
    this.updateHoverHighlight();

    const renderTerritoryStart = FrameProfiler.start();
    this.territoryRenderer.setViewSize(
      context.canvas.width,
      context.canvas.height,
    );
    const viewOffset = this.transformHandler.viewOffset();
    this.territoryRenderer.setViewTransform(
      this.transformHandler.scale,
      viewOffset.x,
      viewOffset.y,
    );
    this.territoryRenderer.render();
    FrameProfiler.end("TerritoryLayer:renderTerritory", renderTerritoryStart);
  }

  private ensureTerritoryCanvasAttached(mainCanvas: HTMLCanvasElement) {
    if (!this.territoryRenderer) {
      return;
    }

    const canvas = this.territoryRenderer.canvas;

    // If the renderer recreated its canvas, detach the old one.
    if (this.attachedTerritoryCanvas !== canvas) {
      this.attachedTerritoryCanvas?.remove();
      this.attachedTerritoryCanvas = canvas;

      // Configure overlay canvas styles once. Avoid per-frame style reads/writes.
      canvas.style.pointerEvents = "none";
      canvas.style.position = "absolute";
      canvas.style.inset = "0";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.display = "block";
    }

    const parent = mainCanvas.parentElement;
    if (!parent) {
      // Fallback: if the canvas isn't in the DOM yet, append to body.
      if (!canvas.isConnected) {
        document.body.appendChild(canvas);
      }
      return;
    }

    // Ensure the main canvas is wrapped in a positioned container so the
    // territory canvas can overlay it without mirroring computed styles.
    let wrapper: HTMLElement;
    const currentParent = mainCanvas.parentElement;
    if (currentParent && currentParent.dataset.territoryOverlay === "1") {
      wrapper = currentParent;
    } else {
      wrapper = document.createElement("div");
      wrapper.dataset.territoryOverlay = "1";
      wrapper.style.position = "relative";
      wrapper.style.display = "inline-block";
      wrapper.style.lineHeight = "0";

      // Replace mainCanvas with wrapper, then re-insert mainCanvas inside wrapper.
      parent.replaceChild(wrapper, mainCanvas);
      wrapper.appendChild(mainCanvas);
    }

    if (this.overlayWrapper !== wrapper) {
      this.overlayWrapper = wrapper;
      this.overlayResizeObserver?.disconnect();
      this.overlayResizeObserver = new ResizeObserver(() => {
        this.syncOverlayWrapperSize(mainCanvas, wrapper);
      });
      this.overlayResizeObserver.observe(mainCanvas);
      // Kick an initial size update; further updates are handled by ResizeObserver.
      this.syncOverlayWrapperSize(mainCanvas, wrapper);
    }

    // Ensure territory canvas is the first child so it's the lowest layer.
    if (canvas.parentElement !== wrapper) {
      canvas.remove();
      wrapper.insertBefore(canvas, mainCanvas);
    } else if (canvas !== wrapper.firstElementChild) {
      wrapper.insertBefore(canvas, mainCanvas);
    }
  }

  private syncOverlayWrapperSize(
    mainCanvas: HTMLCanvasElement,
    wrapper: HTMLElement,
  ) {
    // Ensure the wrapper has real layout size so the absolutely-positioned
    // territory canvas (100% width/height) is non-zero even if the main canvas
    // is positioned absolutely.
    const rect = mainCanvas.getBoundingClientRect();
    const w = rect.width > 0 ? rect.width : mainCanvas.clientWidth;
    const h = rect.height > 0 ? rect.height : mainCanvas.clientHeight;
    if (w > 0) wrapper.style.width = `${w}px`;
    if (h > 0) wrapper.style.height = `${h}px`;
  }

  private markTile(tile: TileRef) {
    this.territoryRenderer?.markTile(tile);
  }

  private updateHoverHighlight() {
    if (!this.territoryRenderer) {
      return;
    }

    const now = performance.now();
    if (now - this.lastHoverUpdateMs < 100) {
      return;
    }
    this.lastHoverUpdateMs = now;

    let nextOwnerSmallId: number | null = null;
    if (this.lastMousePosition) {
      const cell = this.transformHandler.screenToWorldCoordinates(
        this.lastMousePosition.x,
        this.lastMousePosition.y,
      );
      if (this.game.isValidCoord(cell.x, cell.y)) {
        const tile = this.game.ref(cell.x, cell.y);
        const owner = this.game.owner(tile);
        if (owner && owner.isPlayer()) {
          nextOwnerSmallId = owner.smallID();
        }
      }
    }

    if (nextOwnerSmallId === this.hoveredOwnerSmallId) {
      return;
    }
    this.hoveredOwnerSmallId = nextOwnerSmallId;
    this.territoryRenderer.setHighlightedOwnerId(nextOwnerSmallId);
  }

  private computePaletteSignature(): string {
    let maxSmallId = 0;
    for (const player of this.game.playerViews()) {
      maxSmallId = Math.max(maxSmallId, player.smallID());
    }
    const patternsEnabled = this.userSettings.territoryPatterns();
    return `${this.game.playerViews().length}:${maxSmallId}:${patternsEnabled ? 1 : 0}`;
  }

  private refreshPaletteIfNeeded() {
    if (!this.territoryRenderer) {
      return;
    }
    const signature = this.computePaletteSignature();
    if (signature !== this.lastPaletteSignature) {
      this.lastPaletteSignature = signature;
      this.territoryRenderer.refreshPalette();
    }
  }

  private computeDefensePostsSignature(): string {
    // Active + completed posts only.
    const parts: string[] = [];
    for (const u of this.game.units(UnitType.DefensePost)) {
      if (!u.isActive() || u.isUnderConstruction()) continue;
      const tile = u.tile();
      parts.push(
        `${u.owner().smallID()},${this.game.x(tile)},${this.game.y(tile)}`,
      );
    }
    parts.sort();
    return parts.join("|");
  }

  private refreshDefensePostsIfNeeded() {
    if (!this.territoryRenderer) {
      return;
    }
    const signature = this.computeDefensePostsSignature();
    if (signature !== this.lastDefensePostsSignature) {
      this.lastDefensePostsSignature = signature;
      this.territoryRenderer.markDefensePostsDirty();
    }
  }
}
