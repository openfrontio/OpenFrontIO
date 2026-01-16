import { Theme } from "../../../core/configuration/Config";
import { EventBus } from "../../../core/EventBus";
import { UnitType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { AlternateViewEvent, MouseOverEvent } from "../../InputHandler";
import { FrameProfiler } from "../FrameProfiler";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";
import { TerritoryWebGLRenderer } from "./TerritoryWebGLRenderer";

export class TerritoryLayer implements Layer {
  profileName(): string {
    return "TerritoryLayer:renderLayer";
  }

  private attachedTerritoryCanvas: HTMLCanvasElement | null = null;

  private theme: Theme;

  private territoryRenderer: TerritoryWebGLRenderer | null = null;
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
    const { renderer, reason } = TerritoryWebGLRenderer.create(
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

    if (this.attachedTerritoryCanvas !== canvas) {
      this.attachedTerritoryCanvas?.remove();
      this.attachedTerritoryCanvas = canvas;
    }

    const parent = mainCanvas.parentNode;
    if (!parent) {
      if (!canvas.isConnected) {
        document.body.appendChild(canvas);
      }
      return;
    }

    if (!canvas.isConnected) {
      parent.insertBefore(canvas, mainCanvas);
      return;
    }

    if (canvas.parentNode !== parent) {
      parent.insertBefore(canvas, mainCanvas);
      return;
    }

    if (canvas.nextSibling !== mainCanvas) {
      parent.insertBefore(canvas, mainCanvas);
    }
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
