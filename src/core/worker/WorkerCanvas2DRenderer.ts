import { Theme } from "../configuration/Config";
import { TileRef } from "../game/GameMap";
import { TerrainMapData } from "../game/TerrainMapLoader";
import { GameRunner } from "../GameRunner";
import { ClientID, PlayerCosmetics } from "../Schemas";
import { GameViewAdapter } from "./GameViewAdapter";

type Offscreen2D = OffscreenCanvasRenderingContext2D;

export class WorkerCanvas2DRenderer {
  private canvas: OffscreenCanvas | null = null;
  private ctx: Offscreen2D | null = null;

  private rasterCanvas: OffscreenCanvas | null = null;
  private rasterCtx: Offscreen2D | null = null;
  private rasterImage: ImageData | null = null;

  private gameViewAdapter: GameViewAdapter | null = null;
  private gameRunner: GameRunner | null = null;
  private theme: Theme | null = null;

  private ready = false;

  private viewScale = 1;
  private viewOffsetX = 0;
  private viewOffsetY = 0;

  private readonly chunkSize = 64;
  private chunksX = 1;
  private chunksY = 1;

  private dirtyChunkFlags: Uint8Array = new Uint8Array(0);
  private dirtyChunkQueue: Uint32Array = new Uint32Array(0);
  private dirtyHead = 0;
  private dirtyTail = 0;
  private dirtyCapacity = 0;

  private paletteWidth = 1;
  private paletteMaxSmallId = 0;
  private paletteRow0: Uint8Array = new Uint8Array(4);
  private paletteRow1: Uint8Array = new Uint8Array(4);
  private hasExternalPalette = false;

  async init(
    offscreenCanvas: OffscreenCanvas,
    gameRunner: GameRunner,
    mapData: TerrainMapData,
    theme: Theme,
    myClientID: ClientID | null,
    cosmeticsByClientID: Map<ClientID, PlayerCosmetics>,
  ): Promise<void> {
    this.canvas = offscreenCanvas;
    this.ctx = offscreenCanvas.getContext("2d", { alpha: true }) as Offscreen2D;
    if (!this.ctx) {
      throw new Error("Failed to get 2D context for OffscreenCanvas");
    }

    this.gameRunner = gameRunner;
    this.theme = theme;

    this.gameViewAdapter = new GameViewAdapter(
      gameRunner.game,
      mapData,
      theme,
      myClientID,
      cosmeticsByClientID,
    );

    const mapW = gameRunner.game.width();
    const mapH = gameRunner.game.height();
    this.rasterCanvas = new OffscreenCanvas(mapW, mapH);
    this.rasterCtx = this.rasterCanvas.getContext("2d", {
      alpha: true,
      willReadFrequently: true,
    }) as Offscreen2D;
    if (!this.rasterCtx) {
      throw new Error("Failed to get 2D context for raster canvas");
    }

    this.rasterImage = new ImageData(mapW, mapH);

    this.chunksX = Math.ceil(mapW / this.chunkSize);
    this.chunksY = Math.ceil(mapH / this.chunkSize);
    const numChunks = this.chunksX * this.chunksY;

    this.dirtyChunkFlags = new Uint8Array(numChunks);
    // Chunk queue sized so markAllDirty() can enqueue every chunk.
    this.dirtyCapacity = Math.max(1024, numChunks + 1);
    this.dirtyChunkQueue = new Uint32Array(this.dirtyCapacity);
    this.dirtyHead = 0;
    this.dirtyTail = 0;

    this.ready = true;

    // First paint.
    this.rebuildPaletteFromGame();
    this.markAllDirty();
    this.tick();
  }

  dispose(): void {
    this.ready = false;
    this.canvas = null;
    this.ctx = null;
    this.rasterCanvas = null;
    this.rasterCtx = null;
    this.rasterImage = null;
    this.gameViewAdapter = null;
    this.gameRunner = null;
    this.theme = null;
    this.dirtyChunkFlags = new Uint8Array(0);
    this.dirtyChunkQueue = new Uint32Array(0);
    this.dirtyHead = 0;
    this.dirtyTail = 0;
    this.dirtyCapacity = 0;
  }

  setViewSize(width: number, height: number): void {
    if (!this.canvas) return;
    this.canvas.width = Math.max(1, Math.floor(width));
    this.canvas.height = Math.max(1, Math.floor(height));
  }

  setViewTransform(scale: number, offsetX: number, offsetY: number): void {
    this.viewScale = scale;
    this.viewOffsetX = offsetX;
    this.viewOffsetY = offsetY;
  }

  setAlternativeView(_enabled: boolean): void {}
  setHighlightedOwnerId(_ownerSmallId: number | null): void {}
  setPatternsEnabled(enabled: boolean): void {
    this.gameViewAdapter?.setPatternsEnabled(enabled);
    // Patterns affect colours; simplest is a full repaint.
    if (!this.hasExternalPalette) {
      this.rebuildPaletteFromGame();
    }
    this.markAllDirty();
  }

  setPaletteFromBytes(
    paletteWidth: number,
    maxSmallId: number,
    row0: Uint8Array,
    row1: Uint8Array,
  ): void {
    this.paletteWidth = paletteWidth;
    this.paletteMaxSmallId = maxSmallId;
    this.paletteRow0 = row0;
    this.paletteRow1 = row1;
    this.hasExternalPalette = true;
    this.markAllDirty();
  }

  refreshPalette(): void {
    if (!this.hasExternalPalette) {
      this.rebuildPaletteFromGame();
    }
    this.markAllDirty();
  }

  refreshTerrain(): void {
    this.markAllDirty();
  }

  markTile(tile: TileRef): void {
    if (!this.ready || !this.gameRunner) return;
    const x = this.gameRunner.game.x(tile);
    const y = this.gameRunner.game.y(tile);
    this.markChunkAt(x, y);
  }

  markAllDirty(): void {
    if (!this.ready) return;
    this.dirtyChunkFlags.fill(0);
    this.dirtyHead = 0;
    this.dirtyTail = 0;
    const numChunks = this.dirtyChunkFlags.length;
    for (let i = 0; i < numChunks; i++) {
      this.enqueueChunk(i);
    }
  }

  tick(): void {
    if (
      !this.ready ||
      !this.gameRunner ||
      !this.theme ||
      !this.gameViewAdapter ||
      !this.rasterCtx ||
      !this.rasterImage
    ) {
      return;
    }

    const mapW = this.gameRunner.game.width();
    const mapH = this.gameRunner.game.height();
    const data = this.rasterImage.data;

    const budgetMs = 6;
    const start = performance.now();

    while (this.dirtyHead !== this.dirtyTail) {
      if (performance.now() - start > budgetMs) {
        break;
      }

      const chunkId = this.dirtyChunkQueue[this.dirtyHead];
      this.dirtyHead = (this.dirtyHead + 1) % this.dirtyCapacity;
      this.dirtyChunkFlags[chunkId] = 0;

      const cx = chunkId % this.chunksX;
      const cy = Math.floor(chunkId / this.chunksX);
      const sx = cx * this.chunkSize;
      const sy = cy * this.chunkSize;
      const ex = Math.min(mapW, sx + this.chunkSize);
      const ey = Math.min(mapH, sy + this.chunkSize);

      for (let y = sy; y < ey; y++) {
        const row = y * mapW;
        for (let x = sx; x < ex; x++) {
          const tile = this.gameRunner.game.ref(x, y);

          let r = 0,
            g = 0,
            b = 0,
            a = 255;

          if (this.gameRunner.game.hasFallout(tile)) {
            const idx = 0;
            r = this.paletteRow0[idx] ?? 120;
            g = this.paletteRow0[idx + 1] ?? 255;
            b = this.paletteRow0[idx + 2] ?? 71;
          } else if (this.gameRunner.game.hasOwner(tile)) {
            const ownerSmallId = this.gameRunner.game.ownerID(tile);
            const slot = 10 + Math.max(0, ownerSmallId);
            const idx = slot * 4;
            if (idx + 2 < this.paletteRow0.length) {
              r = this.paletteRow0[idx];
              g = this.paletteRow0[idx + 1];
              b = this.paletteRow0[idx + 2];
            } else {
              const rgba = this.theme.terrainColor(
                this.gameRunner.game,
                tile,
              ).rgba;
              r = rgba.r;
              g = rgba.g;
              b = rgba.b;
              a = rgba.a ?? 255;
            }
          } else {
            const rgba = this.theme.terrainColor(
              this.gameRunner.game,
              tile,
            ).rgba;
            r = rgba.r;
            g = rgba.g;
            b = rgba.b;
            a = rgba.a ?? 255;
          }

          const p = (row + x) * 4;
          data[p] = r;
          data[p + 1] = g;
          data[p + 2] = b;
          data[p + 3] = a;
        }
      }

      this.rasterCtx.putImageData(
        this.rasterImage,
        0,
        0,
        sx,
        sy,
        ex - sx,
        ey - sy,
      );
    }
  }

  render(): void {
    if (!this.ready || !this.ctx || !this.gameRunner || !this.rasterCanvas) {
      return;
    }

    const w = (this.canvas?.width ?? 1) as number;
    const h = (this.canvas?.height ?? 1) as number;

    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, w, h);
    this.ctx.imageSmoothingEnabled = false;

    const scale = this.viewScale;
    this.ctx.setTransform(
      scale,
      0,
      0,
      scale,
      this.gameRunner.game.width() / 2 - this.viewOffsetX * scale,
      this.gameRunner.game.height() / 2 - this.viewOffsetY * scale,
    );

    this.ctx.drawImage(
      this.rasterCanvas,
      -this.gameRunner.game.width() / 2,
      -this.gameRunner.game.height() / 2,
    );
  }

  private markChunkAt(x: number, y: number): void {
    const cx = Math.floor(x / this.chunkSize);
    const cy = Math.floor(y / this.chunkSize);
    if (cx < 0 || cy < 0 || cx >= this.chunksX || cy >= this.chunksY) {
      return;
    }
    const chunkId = cx + cy * this.chunksX;
    this.enqueueChunk(chunkId);
  }

  private enqueueChunk(chunkId: number): void {
    if (this.dirtyChunkFlags[chunkId] === 1) {
      return;
    }
    this.dirtyChunkFlags[chunkId] = 1;
    this.dirtyChunkQueue[this.dirtyTail] = chunkId;
    this.dirtyTail = (this.dirtyTail + 1) % this.dirtyCapacity;
    if (this.dirtyTail === this.dirtyHead) {
      // Overflow: fall back to repaint everything next tick.
      this.markAllDirty();
    }
  }

  private rebuildPaletteFromGame(): void {
    if (!this.gameViewAdapter) {
      return;
    }

    let maxSmallId = 0;
    const players = this.gameViewAdapter.playerViews();
    for (const p of players) {
      maxSmallId = Math.max(maxSmallId, p.smallID());
    }

    const RESERVED = 10;
    this.paletteMaxSmallId = maxSmallId;
    this.paletteWidth = RESERVED + Math.max(1, maxSmallId + 1);
    const rowStride = this.paletteWidth * 4;

    const row0 = new Uint8Array(rowStride);
    const row1 = new Uint8Array(rowStride);

    row0[0] = 120;
    row0[1] = 255;
    row0[2] = 71;
    row0[3] = 255;

    for (const p of players) {
      const id = p.smallID();
      if (id <= 0) continue;
      const idx = (RESERVED + id) * 4;

      const tr = p.territoryColor().rgba;
      row0[idx] = tr.r;
      row0[idx + 1] = tr.g;
      row0[idx + 2] = tr.b;
      row0[idx + 3] = 255;

      const br = p.borderColor().rgba;
      row1[idx] = br.r;
      row1[idx + 1] = br.g;
      row1[idx + 2] = br.b;
      row1[idx + 3] = 255;
    }

    this.paletteRow0 = row0;
    this.paletteRow1 = row1;
    this.hasExternalPalette = false;
  }
}
