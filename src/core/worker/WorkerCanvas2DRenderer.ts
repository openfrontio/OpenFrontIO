import { Theme } from "../configuration/Config";
import { PastelTheme } from "../configuration/PastelTheme";
import { PastelThemeDark } from "../configuration/PastelThemeDark";
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
  private terrainBaseRgba: Uint8Array | null = null;

  private gameViewAdapter: GameViewAdapter | null = null;
  private gameRunner: GameRunner | null = null;
  private theme: Theme | null = null;

  private ready = false;
  private mapWidth = 1;
  private mapHeight = 1;

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

    const mapW = gameRunner.game.width();
    const mapH = gameRunner.game.height();
    this.mapWidth = mapW;
    this.mapHeight = mapH;

    this.gameViewAdapter = new GameViewAdapter(
      gameRunner.game,
      mapData,
      theme,
      myClientID,
      cosmeticsByClientID,
    );

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
    this.rebuildTerrainBase();
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
    this.terrainBaseRgba = null;
    this.gameViewAdapter = null;
    this.gameRunner = null;
    this.theme = null;
    this.mapWidth = 1;
    this.mapHeight = 1;
    this.dirtyChunkFlags = new Uint8Array(0);
    this.dirtyChunkQueue = new Uint32Array(0);
    this.dirtyHead = 0;
    this.dirtyTail = 0;
    this.dirtyCapacity = 0;
  }

  setViewSize(width: number, height: number): void {
    if (!this.canvas) return;
    const nextWidth = Math.max(1, Math.floor(width));
    const nextHeight = Math.max(1, Math.floor(height));
    if (this.canvas.width === nextWidth && this.canvas.height === nextHeight) {
      return;
    }
    this.canvas.width = nextWidth;
    this.canvas.height = nextHeight;
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
    this.rebuildTerrainBase();
    this.markAllDirty();
  }

  markTile(tile: TileRef): void {
    if (!this.ready) return;
    // TileRef is a linear index (y * width + x).
    const x = tile % this.mapWidth;
    const y = (tile / this.mapWidth) | 0;
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
      !this.rasterImage ||
      !this.terrainBaseRgba
    ) {
      return;
    }

    const mapW = this.mapWidth;
    const mapH = this.mapHeight;
    const out = this.rasterImage.data;
    const base = this.terrainBaseRgba;
    const state = this.gameRunner.game.tileStateView();
    const row0 = this.paletteRow0;
    const maxSmallId = this.paletteMaxSmallId;

    const falloutR = row0[0] ?? 120;
    const falloutG = row0[1] ?? 255;
    const falloutB = row0[2] ?? 71;
    const ownerMask = 0xfff;
    const falloutBit = 0x2000;

    const mix65 = (a: number, b: number): number =>
      ((a * 35 + b * 65 + 50) / 100) | 0;
    const mix50 = (a: number, b: number): number => (a + b + 1) >> 1;

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
          const tile = row + x;
          const s = state[tile];
          const owner = s & ownerMask;
          const hasFallout = (s & falloutBit) !== 0;

          const p = tile * 4;
          const tr = base[p];
          const tg = base[p + 1];
          const tb = base[p + 2];

          // Fast path: terrain only.
          if (owner === 0 && !hasFallout) {
            out[p] = tr;
            out[p + 1] = tg;
            out[p + 2] = tb;
            out[p + 3] = 255;
            continue;
          }

          let r = tr;
          let g = tg;
          let b = tb;

          if (owner !== 0) {
            // Player colors start at slot 10.
            if (owner <= maxSmallId) {
              const idx = (10 + owner) * 4;
              if (idx + 2 < row0.length) {
                let pr = row0[idx];
                let pg = row0[idx + 1];
                let pb = row0[idx + 2];

                if (hasFallout) {
                  pr = mix50(pr, falloutR);
                  pg = mix50(pg, falloutG);
                  pb = mix50(pb, falloutB);
                }

                r = mix65(tr, pr);
                g = mix65(tg, pg);
                b = mix65(tb, pb);
              }
            }
          } else if (hasFallout) {
            r = mix50(tr, falloutR);
            g = mix50(tg, falloutG);
            b = mix50(tb, falloutB);
          }

          out[p] = r;
          out[p + 1] = g;
          out[p + 2] = b;
          out[p + 3] = 255;
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

  private rebuildTerrainBase(): void {
    if (!this.gameRunner || !this.theme || !this.rasterImage) {
      return;
    }

    const mapW = this.mapWidth;
    const mapH = this.mapHeight;
    const numTiles = mapW * mapH;
    const terrain = this.gameRunner.game.terrainDataView();
    const base = new Uint8Array(numTiles * 4);

    const isDark = this.theme instanceof PastelThemeDark;
    const isPastel =
      this.theme instanceof PastelTheme ||
      this.theme instanceof PastelThemeDark;

    if (isPastel) {
      // Decode terrain directly from packed terrain bytes (fast, no allocations).
      const shoreR = isDark ? 134 : 204;
      const shoreG = isDark ? 133 : 203;
      const shoreB = isDark ? 88 : 158;

      const shorelineWaterR = isDark ? 50 : 100;
      const shorelineWaterG = isDark ? 50 : 143;
      const shorelineWaterB = isDark ? 50 : 255;

      const waterBaseR = isDark ? 14 : 70;
      const waterBaseG = isDark ? 11 : 132;
      const waterBaseB = isDark ? 30 : 180;

      for (let t = 0; t < numTiles; t++) {
        const b = terrain[t];
        const isLand = (b & 0x80) !== 0;
        const isShoreline = (b & 0x40) !== 0;
        const mag = b & 0x1f;

        let r = 0,
          g = 0,
          bb = 0;

        if (isLand && isShoreline) {
          r = shoreR;
          g = shoreG;
          bb = shoreB;
        } else if (!isLand) {
          // Water (ocean + lake share the same formula here).
          if (isShoreline) {
            r = shorelineWaterR;
            g = shorelineWaterG;
            bb = shorelineWaterB;
          } else if (isDark) {
            if (mag < 10) {
              const adj = 9 - mag;
              r = Math.max(waterBaseR + adj, 0);
              g = Math.max(waterBaseG + adj, 0);
              bb = Math.max(waterBaseB + adj, 0);
            } else {
              r = waterBaseR;
              g = waterBaseG;
              bb = waterBaseB;
            }
          } else {
            const m = mag < 10 ? mag : 10;
            const adj = 1 - m;
            r = Math.max(waterBaseR + adj, 0);
            g = Math.max(waterBaseG + adj, 0);
            bb = Math.max(waterBaseB + adj, 0);
          }
        } else {
          // Land (non-shore)
          if (mag < 10) {
            r = isDark ? 140 : 190;
            g = (isDark ? 170 : 220) - 2 * mag;
            bb = isDark ? 88 : 138;
          } else if (mag < 20) {
            r = (isDark ? 150 : 200) + 2 * mag;
            g = (isDark ? 133 : 183) + 2 * mag;
            bb = (isDark ? 88 : 138) + 2 * mag;
          } else {
            const half = mag >> 1;
            r = (isDark ? 180 : 230) + half;
            g = (isDark ? 180 : 230) + half;
            bb = (isDark ? 180 : 230) + half;
          }
        }

        const p = t * 4;
        base[p] = r;
        base[p + 1] = g;
        base[p + 2] = bb;
        base[p + 3] = 255;
      }
    } else {
      // Fallback for other themes: call the theme once per tile (slow but only on init/theme change).
      for (let t = 0; t < numTiles; t++) {
        const rgba = this.theme.terrainColor(
          this.gameRunner.game,
          t as TileRef,
        ).rgba;
        const p = t * 4;
        base[p] = rgba.r;
        base[p + 1] = rgba.g;
        base[p + 2] = rgba.b;
        base[p + 3] = rgba.a ?? 255;
      }
    }

    this.terrainBaseRgba = base;
  }
}
