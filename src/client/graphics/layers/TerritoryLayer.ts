import { Theme } from "../../../core/configuration/Config";
import { EventBus } from "../../../core/EventBus";
import { TileRef } from "../../../core/game/GameMap";
import { GameView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { AlternateViewEvent, MouseOverEvent } from "../../InputHandler";
import { Canvas2DRendererProxy } from "../canvas2d/Canvas2DRendererProxy";
import { FrameProfiler } from "../FrameProfiler";
import { TransformHandler } from "../TransformHandler";
import {
  buildTerrainShaderParams,
  readTerrainShaderId,
} from "../webgpu/render/TerrainShaderRegistry";
import {
  buildTerritoryPostSmoothingParams,
  readTerritoryPostSmoothingId,
} from "../webgpu/render/TerritoryPostSmoothingRegistry";
import {
  buildTerritoryPreSmoothingParams,
  readTerritoryPreSmoothingId,
} from "../webgpu/render/TerritoryPreSmoothingRegistry";
import {
  buildTerritoryShaderParams,
  readTerritoryShaderId,
} from "../webgpu/render/TerritoryShaderRegistry";
import { TerritoryRenderer } from "../webgpu/TerritoryRenderer";
import { TerritoryRendererProxy } from "../webgpu/TerritoryRendererProxy";
import { Layer } from "./Layer";

export class TerritoryLayer implements Layer {
  profileName(): string {
    return "TerritoryLayer:renderLayer";
  }

  private attachedTerritoryCanvas: HTMLCanvasElement | null = null;
  private attachedMainCanvas: HTMLCanvasElement | null = null;

  private overlayWrapper: HTMLElement | null = null;
  private overlayResizeObserver: ResizeObserver | null = null;

  private theme: Theme;

  private territoryRenderer:
    | TerritoryRenderer
    | TerritoryRendererProxy
    | Canvas2DRendererProxy
    | null = null;
  private alternativeView = false;

  private lastPaletteSignature: string | null = null;
  private lastPatternsEnabled: boolean | null = null;
  private lastTerrainShaderSignature: string | null = null;
  private lastTerritoryShaderSignature: string | null = null;
  private lastPreSmoothingSignature: string | null = null;
  private lastPostSmoothingSignature: string | null = null;

  private lastPaletteSyncMs = 0;
  private lastUserSettingsSyncMs = 0;

  private lastViewWidth = 0;
  private lastViewHeight = 0;
  private viewTransformSynced = false;

  private lastMousePosition: { x: number; y: number } | null = null;
  private hoveredOwnerSmallId: number | null = null;
  private lastHoverUpdateMs = 0;
  private hoverRequestSeq = 0;
  private hoverTile: TileRef | null = null;
  private hoverQueryInFlight = false;
  private pendingHoverTile: TileRef | null = null;

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
      this.territoryRenderer?.refreshTerrain();
      this.redraw();
    }

    const now = performance.now();
    this.syncUserSettingsMaybe(now);
    this.syncPaletteMaybe(now);

    // Renderer tick and dirty-tile marking are driven in the worker from
    // simulation-derived tile mutations (onTileStateChanged). The main thread
    // only drives render frames + view transforms.

    FrameProfiler.end("TerritoryLayer:tick", tickProfile);
  }

  redraw() {
    this.configureRenderer();
  }

  private configureRenderer() {
    const backend = this.userSettings.backgroundRenderer();
    const create = (b: "webgpu" | "canvas2d") =>
      b === "canvas2d"
        ? Canvas2DRendererProxy.create(this.game, this.theme, this.game.worker)
        : TerritoryRendererProxy.create(
            this.game,
            this.theme,
            this.game.worker,
          );

    let { renderer, reason } = create(backend);
    if (!renderer && backend === "webgpu") {
      // Graceful fallback: allow the game to run even without WebGPU.
      console.warn(
        `WebGPU renderer unavailable (${reason ?? "unknown"}); falling back to Canvas2D worker renderer.`,
      );
      ({ renderer, reason } = create("canvas2d"));
    }

    if (!renderer) {
      throw new Error(reason ?? "No supported background renderer available.");
    }

    this.territoryRenderer = renderer;
    this.attachedTerritoryCanvas = null;
    this.attachedMainCanvas = null;
    this.lastViewWidth = 0;
    this.lastViewHeight = 0;
    this.viewTransformSynced = false;
    const patternsEnabled = this.userSettings.territoryPatterns();
    this.lastPatternsEnabled = patternsEnabled;
    this.territoryRenderer.setPatternsEnabled(patternsEnabled);
    this.territoryRenderer.setAlternativeView(this.alternativeView);
    this.territoryRenderer.setHighlightedOwnerId(this.hoveredOwnerSmallId);
    this.applyTerrainShaderSettings(true);
    this.applyTerritoryShaderSettings(true);
    this.applyTerritorySmoothingSettings(true);
    this.territoryRenderer.markAllDirty();
    this.territoryRenderer.refreshPalette();
    this.lastPaletteSignature = this.computePaletteSignature();

    // Run an initial tick to upload state and build the colour texture. Without
    // this, the first render call may occur before the initial compute pass
    // has been executed, resulting in undefined colours.
    // Note: compute passes are ticked in the worker at simulation cadence.
  }

  renderLayer(context: CanvasRenderingContext2D) {
    if (!this.territoryRenderer) {
      return;
    }

    // Check for theme changes in renderLayer too (for when game is paused)
    const currentTheme = this.game.config().theme();
    if (currentTheme !== this.theme) {
      this.theme = currentTheme;
      this.territoryRenderer.refreshTerrain();
      this.redraw();
    }

    // Apply user settings even while the game is paused (settings modal), but
    // avoid heavy polling work in the RAF hot path.
    const now = performance.now();
    this.syncUserSettingsMaybe(now);
    this.syncPaletteMaybe(now);

    if (
      this.attachedMainCanvas !== context.canvas ||
      !this.attachedTerritoryCanvas ||
      !this.attachedTerritoryCanvas.isConnected
    ) {
      this.attachedMainCanvas = context.canvas;
      this.ensureTerritoryCanvasAttached(context.canvas);
    }
    this.updateHoverHighlight();

    const renderTerritoryStart = FrameProfiler.start();
    const w = context.canvas.width;
    const h = context.canvas.height;
    if (w !== this.lastViewWidth || h !== this.lastViewHeight) {
      this.lastViewWidth = w;
      this.lastViewHeight = h;
      this.territoryRenderer.setViewSize(w, h);
    }
    if (!this.viewTransformSynced || this.transformHandler.hasChanged()) {
      this.viewTransformSynced = true;
      this.territoryRenderer.setViewTransform(
        this.transformHandler.scale,
        this.transformHandler.getOffsetX(),
        this.transformHandler.getOffsetY(),
      );
    }
    this.territoryRenderer.render();
    FrameProfiler.end("TerritoryLayer:renderTerritory", renderTerritoryStart);
  }

  private ensureTerritoryCanvasAttached(mainCanvas: HTMLCanvasElement) {
    if (!this.territoryRenderer) {
      return;
    }

    const canvas = this.territoryRenderer.canvas;

    // Canvas must be HTMLCanvasElement for DOM operations (proxy always provides this)
    if (!(canvas instanceof HTMLCanvasElement)) {
      return;
    }

    // If the renderer recreated its canvas, detach the old one.
    if (this.attachedTerritoryCanvas !== canvas) {
      this.attachedTerritoryCanvas?.remove();
      this.attachedTerritoryCanvas = canvas;
      this.attachedMainCanvas = mainCanvas;

      // Configure overlay canvas styles once. Avoid per-frame style reads/writes.
      canvas.style.pointerEvents = "none";
      canvas.style.position = "absolute";
      canvas.style.inset = "0";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.display = "block";
    }

    const currentParent = mainCanvas.parentElement;
    if (!currentParent) {
      // Fallback: if the canvas isn't in the DOM yet, append to body.
      if (!canvas.isConnected) {
        document.body.appendChild(canvas);
      }
      return;
    }

    // Ensure the main canvas is wrapped in a positioned container so the
    // territory canvas can overlay it without mirroring computed styles.
    let wrapper: HTMLElement;
    if (currentParent.dataset.territoryOverlay === "1") {
      wrapper = currentParent;
    } else {
      wrapper = document.createElement("div");
      wrapper.dataset.territoryOverlay = "1";
      wrapper.style.position = "relative";
      wrapper.style.display = "inline-block";
      wrapper.style.lineHeight = "0";

      // Replace mainCanvas with wrapper, then re-insert mainCanvas inside wrapper.
      currentParent.replaceChild(wrapper, mainCanvas);
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

  private updateHoverHighlight() {
    if (!this.territoryRenderer) {
      return;
    }

    const now = performance.now();
    if (now - this.lastHoverUpdateMs < 100) {
      return;
    }
    this.lastHoverUpdateMs = now;

    if (!this.lastMousePosition) {
      this.hoverTile = null;
      this.pendingHoverTile = null;
      if (this.hoveredOwnerSmallId !== null) {
        this.hoveredOwnerSmallId = null;
        this.territoryRenderer.setHighlightedOwnerId(null);
      }
      return;
    }

    const cell = this.transformHandler.screenToWorldCoordinates(
      this.lastMousePosition.x,
      this.lastMousePosition.y,
    );
    if (!this.game.isValidCoord(cell.x, cell.y)) {
      this.hoverTile = null;
      this.pendingHoverTile = null;
      if (this.hoveredOwnerSmallId !== null) {
        this.hoveredOwnerSmallId = null;
        this.territoryRenderer.setHighlightedOwnerId(null);
      }
      return;
    }

    const tile = this.game.ref(cell.x, cell.y);

    // Only query on tile changes; keep at most one query in flight.
    if (this.hoverTile === tile && this.pendingHoverTile === null) {
      return;
    }
    this.hoverTile = tile;
    this.pendingHoverTile = tile;

    if (this.hoverQueryInFlight) {
      return;
    }

    const doQuery = () => {
      const nextTile = this.pendingHoverTile;
      if (nextTile === null) {
        this.hoverQueryInFlight = false;
        return;
      }
      this.pendingHoverTile = null;
      this.hoverQueryInFlight = true;

      const seq = ++this.hoverRequestSeq;
      this.game.worker
        .tileContext(nextTile)
        .then((ctx) => {
          if (seq !== this.hoverRequestSeq) {
            return;
          }
          const nextOwnerSmallId = ctx.ownerSmallId;
          if (nextOwnerSmallId === this.hoveredOwnerSmallId) {
            return;
          }
          this.hoveredOwnerSmallId = nextOwnerSmallId;
          this.territoryRenderer?.setHighlightedOwnerId(nextOwnerSmallId);
        })
        .catch((err) => {
          // Hover is best-effort; avoid spamming logs.
          console.warn("tileContext hover lookup failed:", err);
        })
        .finally(() => {
          this.hoverQueryInFlight = false;
          if (this.pendingHoverTile !== null) {
            doQuery();
          }
        });
    };

    doQuery();
  }

  private computePaletteSignature(): string {
    const players = this.game.playerViews();

    const fnvByte = (hash: number, byte: number): number =>
      Math.imul(hash ^ (byte & 0xff), 16777619) >>> 0;

    const fnv32 = (hash: number, value: number): number => {
      hash = fnvByte(hash, value);
      hash = fnvByte(hash, value >>> 8);
      hash = fnvByte(hash, value >>> 16);
      hash = fnvByte(hash, value >>> 24);
      return hash;
    };

    let hash = 2166136261;
    hash = fnv32(hash, players.length);

    let maxSmallId = 0;
    for (const player of players) {
      const id = player.smallID();
      maxSmallId = Math.max(maxSmallId, id);

      hash = fnv32(hash, id);

      const tc = player.territoryColor().rgba;
      hash = fnvByte(hash, tc.r);
      hash = fnvByte(hash, tc.g);
      hash = fnvByte(hash, tc.b);

      const bc = player.borderColor().rgba;
      hash = fnvByte(hash, bc.r);
      hash = fnvByte(hash, bc.g);
      hash = fnvByte(hash, bc.b);
    }
    hash = fnv32(hash, maxSmallId);

    return `${hash}`;
  }

  private syncPaletteMaybe(nowMs: number, force: boolean = false) {
    if (!this.territoryRenderer) {
      return;
    }

    // Palette rebuild is relatively expensive (builds & transfers full rows),
    // so only check periodically. The worker handles most palette dirtiness,
    // but the main thread still owns the theme-derived colour mapping.
    if (!force && nowMs - this.lastPaletteSyncMs < 500) {
      return;
    }
    this.lastPaletteSyncMs = nowMs;

    const signature = this.computePaletteSignature();
    if (signature !== this.lastPaletteSignature) {
      this.lastPaletteSignature = signature;
      this.territoryRenderer.refreshPalette();
    }
  }

  private syncUserSettingsMaybe(nowMs: number, force: boolean = false) {
    if (!this.territoryRenderer) {
      return;
    }

    // Shader settings are user-driven and change rarely; avoid allocating
    // signatures and arrays every RAF.
    if (!force && nowMs - this.lastUserSettingsSyncMs < 250) {
      return;
    }
    this.lastUserSettingsSyncMs = nowMs;

    const patternsEnabled = this.userSettings.territoryPatterns();
    if (patternsEnabled !== this.lastPatternsEnabled) {
      this.lastPatternsEnabled = patternsEnabled;
      this.territoryRenderer.setPatternsEnabled(patternsEnabled);
    }

    this.applyTerrainShaderSettings();
    this.applyTerritoryShaderSettings();
    this.applyTerritorySmoothingSettings();
  }

  private applyTerritoryShaderSettings(force: boolean = false) {
    if (!this.territoryRenderer) {
      return;
    }

    const shaderId = readTerritoryShaderId(this.userSettings);
    const { shaderPath, params0, params1 } = buildTerritoryShaderParams(
      this.userSettings,
      shaderId,
    );

    const signature = `${shaderPath}:${Array.from(params0).join(",")}:${Array.from(params1).join(",")}`;
    if (!force && signature === this.lastTerritoryShaderSignature) {
      return;
    }
    this.lastTerritoryShaderSignature = signature;

    this.territoryRenderer.setTerritoryShader(shaderPath);
    this.territoryRenderer.setTerritoryShaderParams(params0, params1);
  }

  private applyTerrainShaderSettings(force: boolean = false) {
    if (!this.territoryRenderer) {
      return;
    }

    const terrainId = readTerrainShaderId(this.userSettings);
    const { shaderPath, params0, params1 } = buildTerrainShaderParams(
      this.userSettings,
      terrainId,
    );
    const signature = `${shaderPath}:${Array.from(params0).join(",")}:${Array.from(params1).join(",")}`;
    if (!force && signature === this.lastTerrainShaderSignature) {
      return;
    }
    this.lastTerrainShaderSignature = signature;
    this.territoryRenderer.setTerrainShader(shaderPath);
    this.territoryRenderer.setTerrainShaderParams(params0, params1);
  }

  private applyTerritorySmoothingSettings(force: boolean = false) {
    if (!this.territoryRenderer) {
      return;
    }

    const preId = readTerritoryPreSmoothingId(this.userSettings);
    const preParams = buildTerritoryPreSmoothingParams(
      this.userSettings,
      preId,
    );
    const preSignature = `${preId}:${Array.from(preParams.params0).join(",")}`;
    if (force || preSignature !== this.lastPreSmoothingSignature) {
      this.lastPreSmoothingSignature = preSignature;
      this.territoryRenderer.setPreSmoothing(
        preParams.enabled,
        preParams.shaderPath,
        preParams.params0,
      );
    }

    const postId = readTerritoryPostSmoothingId(this.userSettings);
    const postParams = buildTerritoryPostSmoothingParams(
      this.userSettings,
      postId,
    );
    const postSignature = `${postId}:${Array.from(postParams.params0).join(",")}`;
    if (force || postSignature !== this.lastPostSmoothingSignature) {
      this.lastPostSmoothingSignature = postSignature;
      this.territoryRenderer.setPostSmoothing(
        postParams.enabled,
        postParams.shaderPath,
        postParams.params0,
      );
    }
  }
}
