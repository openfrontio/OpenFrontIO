import { Colord } from "colord";
import { Theme } from "../../../core/configuration/Config";
import { UnitType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { FrameProfiler } from "../FrameProfiler";
import {
  HoverHighlightOptions,
  TerritoryWebGLRenderer,
} from "./TerritoryWebGLRenderer";

export interface TerritoryRendererStrategy {
  isWebGL(): boolean;
  redraw(): void;
  markAllDirty(): void;
  paintTile(tile: TileRef): void;
  render(
    context: CanvasRenderingContext2D,
    viewport: { x: number; y: number; width: number; height: number },
    shouldBlit: boolean,
  ): void;
  setAlternativeView(enabled: boolean): void;
  setHover(playerSmallId: number | null): void;
  setHoverHighlightOptions(options: HoverHighlightOptions): void;
  refreshPalette(): void;
  clearTile(tile: TileRef): void;
}

export class CanvasTerritoryRenderer implements TerritoryRendererStrategy {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private imageData: ImageData;
  private alternativeImageData: ImageData;
  private alternativeView = false;

  constructor(
    private readonly game: GameView,
    private readonly theme: Theme,
  ) {
    this.canvas = document.createElement("canvas");
    const context = this.canvas.getContext("2d");
    if (!context) throw new Error("2d context not supported");
    this.context = context;
    this.imageData = context.createImageData(1, 1);
    this.alternativeImageData = context.createImageData(1, 1);
  }

  isWebGL(): boolean {
    return false;
  }

  redraw() {
    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();
    this.imageData = this.context.getImageData(
      0,
      0,
      this.canvas.width,
      this.canvas.height,
    );
    this.alternativeImageData = this.context.getImageData(
      0,
      0,
      this.canvas.width,
      this.canvas.height,
    );
    this.initImageData();
  }

  markAllDirty(): void {
    // No special handling needed for canvas path.
  }

  paintTile(tile: TileRef) {
    const cpuStart = FrameProfiler.start();
    const hasOwner = this.game.hasOwner(tile);
    const rawOwner = hasOwner ? this.game.owner(tile) : null;
    const owner =
      rawOwner &&
      typeof (rawOwner as any).isPlayer === "function" &&
      (rawOwner as any).isPlayer()
        ? (rawOwner as PlayerView)
        : null;
    const isBorderTile = this.game.isBorder(tile);
    const hasFallout = this.game.hasFallout(tile);
    let isDefended = false;
    if (owner && isBorderTile) {
      isDefended = this.game.hasUnitNearby(
        tile,
        this.game.config().defensePostRange(),
        UnitType.DefensePost,
        owner.id(),
      );
    }

    if (!owner) {
      if (hasFallout) {
        this.paintTileColor(
          this.imageData,
          tile,
          this.theme.falloutColor(),
          150,
        );
        this.paintTileColor(
          this.alternativeImageData,
          tile,
          this.theme.falloutColor(),
          150,
        );
      } else {
        this.clearTile(tile);
      }
      FrameProfiler.end("TerritoryLayer:paintTerritory.cpu", cpuStart);
      return;
    }

    const myPlayer = this.game.myPlayer();

    if (isBorderTile) {
      if (myPlayer) {
        const alternativeColor = this.alternateViewColor(owner);
        this.paintTileColor(
          this.alternativeImageData,
          tile,
          alternativeColor,
          255,
        );
      }
      this.paintTileColor(
        this.imageData,
        tile,
        owner.borderColor(tile, isDefended),
        255,
      );
    } else {
      // Alternative view only shows borders.
      this.clearAlternativeTile(tile);
      this.paintTileColor(
        this.imageData,
        tile,
        owner.territoryColor(tile),
        150,
      );
    }
    FrameProfiler.end("TerritoryLayer:paintTerritory.cpu", cpuStart);
  }

  render(
    context: CanvasRenderingContext2D,
    viewport: { x: number; y: number; width: number; height: number },
    shouldBlit: boolean,
  ) {
    const { x, y, width, height } = viewport;
    if (width <= 0 || height <= 0) {
      return;
    }
    if (shouldBlit) {
      const putImageStart = FrameProfiler.start();
      this.context.putImageData(
        this.alternativeView ? this.alternativeImageData : this.imageData,
        0,
        0,
        x,
        y,
        width,
        height,
      );
      FrameProfiler.end("TerritoryLayer:putImageData", putImageStart);
    }

    const drawCanvasStart = FrameProfiler.start();
    context.drawImage(
      this.canvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
    FrameProfiler.end("TerritoryLayer:drawCanvas", drawCanvasStart);
  }

  setAlternativeView(enabled: boolean): void {
    this.alternativeView = enabled;
  }

  setHover(): void {
    // Canvas path relies on CPU highlight redraw in TerritoryLayer.
  }

  setHoverHighlightOptions(): void {
    // Not used in canvas mode.
  }

  refreshPalette(): void {
    // Nothing to refresh for canvas path.
  }

  clearTile(tile: TileRef) {
    const offset = tile * 4;
    this.imageData.data[offset + 3] = 0;
    this.alternativeImageData.data[offset + 3] = 0;
  }

  private alternateViewColor(other: PlayerView): Colord {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) {
      return this.theme.neutralColor();
    }
    if (other.smallID() === myPlayer.smallID()) {
      return this.theme.selfColor();
    }
    if (other.isFriendly(myPlayer)) {
      return this.theme.allyColor();
    }
    if (!other.hasEmbargo(myPlayer)) {
      return this.theme.neutralColor();
    }
    return this.theme.enemyColor();
  }

  private paintTileColor(
    imageData: ImageData,
    tile: TileRef,
    color: Colord,
    alpha: number,
  ) {
    const offset = tile * 4;
    imageData.data[offset] = color.rgba.r;
    imageData.data[offset + 1] = color.rgba.g;
    imageData.data[offset + 2] = color.rgba.b;
    imageData.data[offset + 3] = alpha;
  }

  private clearAlternativeTile(tile: TileRef) {
    const offset = tile * 4;
    this.alternativeImageData.data[offset + 3] = 0;
  }

  private initImageData() {
    this.game.forEachTile((tile) => {
      const offset = tile * 4;
      this.imageData.data[offset + 3] = 0;
      this.alternativeImageData.data[offset + 3] = 0;
    });
  }
}

export class WebglTerritoryRenderer implements TerritoryRendererStrategy {
  constructor(
    private readonly renderer: TerritoryWebGLRenderer,
    private readonly game: GameView,
  ) {}

  isWebGL(): boolean {
    return true;
  }

  redraw(): void {
    this.markAllDirty();
  }

  markAllDirty(): void {
    this.renderer.markAllDirty();
  }

  paintTile(tile: TileRef): void {
    const hasOwner = this.game.hasOwner(tile);
    const rawOwner = hasOwner ? this.game.owner(tile) : null;
    const owner =
      rawOwner &&
      typeof (rawOwner as any).isPlayer === "function" &&
      (rawOwner as any).isPlayer()
        ? (rawOwner as PlayerView)
        : null;
    const isBorderTile = this.game.isBorder(tile);
    let isDefended = false;
    if (owner && isBorderTile) {
      isDefended = this.game.hasUnitNearby(
        tile,
        this.game.config().defensePostRange(),
        UnitType.DefensePost,
        owner.id(),
      );
    }

    this.renderer.markTile(tile);
    if (!owner || !isBorderTile) {
      this.renderer.clearBorderColor(tile);
    } else {
      const borderCol = owner.borderColor(tile, isDefended).rgba;
      this.renderer.setBorderColor(tile, {
        r: borderCol.r,
        g: borderCol.g,
        b: borderCol.b,
        a: Math.round((borderCol.a ?? 1) * 255),
      });
    }
  }

  render(
    context: CanvasRenderingContext2D,
    _viewport: { x: number; y: number; width: number; height: number },
    _shouldBlit: boolean,
  ): void {
    const webglRenderStart = FrameProfiler.start();
    this.renderer.render();
    FrameProfiler.end("TerritoryLayer:territoryWebGL.render", webglRenderStart);

    const drawCanvasStart = FrameProfiler.start();
    context.drawImage(
      this.renderer.canvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
    FrameProfiler.end(
      "TerritoryLayer:territoryWebGL.drawImage",
      drawCanvasStart,
    );
  }

  setAlternativeView(enabled: boolean): void {
    this.renderer.setAlternativeView(enabled);
  }

  setHover(playerSmallId: number | null): void {
    this.renderer.setHoveredPlayerId(playerSmallId ?? null);
  }

  setHoverHighlightOptions(options: HoverHighlightOptions): void {
    this.renderer.setHoverHighlightOptions(options);
  }

  refreshPalette(): void {
    this.renderer.refreshPalette();
  }

  clearTile(): void {
    // No-op for WebGL; canvas alpha clearing is not used.
  }
}
