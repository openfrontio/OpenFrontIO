/**
 * CosmeticPreviewRenderer — lightweight WebGL2 renderer for in-game store cosmetic previewing.
 */

import type { Config } from "../../../core/configuration/Config";
import { Camera } from "../gl/Camera";
import { initGL } from "../gl/initGL";
import { calculateExplosionDurationMs, FxPass } from "../gl/passes/fx-pass";
import { SpiralRibbonPass } from "../gl/passes/SpiralRibbonPass";
import { StructurePass } from "../gl/passes/StructurePass";
import { TerrainPass } from "../gl/passes/TerrainPass";
import { TrailPass } from "../gl/passes/TrailPass";
import { UnitPass } from "../gl/passes/UnitPass";
import { applyGraphicsOverrides } from "../gl/RenderOverrides";
import { createRenderSettings, RenderSettings } from "../gl/RenderSettings";
import {
  EFFECT_PALETTE_BLOCKS,
  getPaletteSize,
  hexToRgb,
  MAX_TRAIL_COLORS,
  STRUCTURES_EFFECT_BLOCK,
  WARSHIP_EFFECT_BLOCK,
} from "../gl/utils/ColorUtils";
import { renderDpr } from "../gl/utils/Dpr";
import { createTexture2D } from "../gl/utils/GlUtils";
import type {
  NukeExplosionRenderParams,
  RendererConfig,
  UnitState,
} from "../types/Renderer";
import {
  UT_ATOM_BOMB,
  UT_CITY,
  UT_DEFENSE_POST,
  UT_FACTORY,
  UT_HYDROGEN_BOMB,
  UT_MIRV,
  UT_MIRV_WARHEAD,
  UT_MISSILE_SILO,
  UT_PORT,
  UT_SAM_LAUNCHER,
  UT_SAM_MISSILE,
  UT_SHELL,
  UT_TRADE_SHIP,
  UT_TRANSPORT,
  UT_WARSHIP,
} from "../types/UnitType";
import {
  PREVIEW_OWNER_ID,
  PreviewTerritoryPass,
} from "./passes/PreviewTerritoryPass";
import {
  CosmeticPreviewMode,
  PreviewAnimationSnapshot,
  PreviewAnimationTicker,
} from "./PreviewAnimationTicker";
import {
  generatePreviewMap,
  PREVIEW_MAP_DIM,
  PreviewTerrainPreset,
} from "./PreviewMapGenerator";

export interface CosmeticPreviewConfig {
  mode: CosmeticPreviewMode;
  cosmeticUnitType?: string;
  structureLevel?: number;
  skinUrl?: string;
  patternData?: string;
  effectColors?: readonly string[];
  movementSpeed?: number;
  frequency?: number;
  colorSize?: number;
  spiralRadius?: number;
  spiralStrands?: number;
  spiralSpeed?: number;
  explosionParams?: NukeExplosionRenderParams;
  salvoMode?: boolean;
}

/** Simulated tick length — units advance and flicker once per tick, as in a match. */
const PREVIEW_TICK_MS = 100;

const DEFAULT_FILL: readonly [number, number, number] = [0.2, 0.6, 0.95];
const DEFAULT_BORDER: readonly [number, number, number] = [0.1, 0.35, 0.7];

const ALL_STRUCTURE_TYPES = [
  UT_CITY,
  UT_PORT,
  UT_FACTORY,
  UT_DEFENSE_POST,
  UT_SAM_LAUNCHER,
  UT_MISSILE_SILO,
];

const ALL_MOBILE_UNIT_TYPES = [
  UT_TRANSPORT,
  UT_TRADE_SHIP,
  UT_WARSHIP,
  UT_ATOM_BOMB,
  UT_HYDROGEN_BOMB,
  UT_MIRV,
  UT_SAM_MISSILE,
  UT_SHELL,
  UT_MIRV_WARHEAD,
];

export class CosmeticPreviewRenderer {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;
  public camera: Camera;

  private paletteTex: WebGLTexture;
  private paletteData = new Float32Array(getPaletteSize() * 2 * 4);
  private effectTex: WebGLTexture;
  private trailTex: WebGLTexture;
  private liveTrailData = new Uint16Array(PREVIEW_MAP_DIM * PREVIEW_MAP_DIM);
  private lastActiveTrailIndices: number[] = [];
  private effectBuffer = new Float32Array(
    getPaletteSize() * MAX_TRAIL_COLORS * EFFECT_PALETTE_BLOCKS * 4,
  );

  private terrainPass: TerrainPass;
  private territoryPass: PreviewTerritoryPass;
  private unitPass: UnitPass;
  private structurePass: StructurePass;
  private trailPass: TrailPass;
  private spiralPass: SpiralRibbonPass;
  private fxPass: FxPass;

  private ticker: PreviewAnimationTicker;
  private currentMode: CosmeticPreviewMode = "SKIN";
  private currentPreset: PreviewTerrainPreset = "CONTINENTAL_ARCHIPELAGO";
  private currentConfig?: CosmeticPreviewConfig;
  private explosionParams?: NukeExplosionRenderParams;
  private isDisposed = false;
  private initialized = false;
  private frameTick = 0;
  private lastUnitTick = -1;

  private unitMap = new Map<number, UnitState>();

  constructor(private readonly canvas: HTMLCanvasElement) {
    const glRes = initGL(canvas, {
      alpha: false,
      premultipliedAlpha: false,
    });
    if (!glRes.gl) {
      throw new Error(`WebGL2 unavailable: ${glRes.status}`);
    }
    this.gl = glRes.gl;
    this.settings = createRenderSettings();
    applyGraphicsOverrides(this.settings, {});
    this.camera = new Camera(PREVIEW_MAP_DIM, PREVIEW_MAP_DIM);

    this.paletteTex = this.createPaletteTexture();
    this.effectTex = this.createEffectTexture();
    this.trailTex = this.createTrailTexture();

    const mapData = generatePreviewMap("CONTINENTAL_ARCHIPELAGO");
    this.terrainPass = new TerrainPass(
      this.gl,
      () => mapData.terrainBytes,
      mapData.terrainBytes,
      mapData.mapW,
      mapData.mapH,
    );

    this.territoryPass = new PreviewTerritoryPass(
      this.gl,
      PREVIEW_MAP_DIM,
      PREVIEW_MAP_DIM,
      this.paletteTex,
      this.settings,
      mapData.tileState,
    );

    const rendererHeader: RendererConfig = {
      mapWidth: PREVIEW_MAP_DIM,
      mapHeight: PREVIEW_MAP_DIM,
      unitTypes: ALL_MOBILE_UNIT_TYPES,
      players: [],
    } as unknown as RendererConfig;

    const mockConfig = {
      msPerTick: () => PREVIEW_TICK_MS,
    } as Config;

    this.unitPass = new UnitPass(
      this.gl,
      rendererHeader,
      this.paletteTex,
      this.effectTex,
      this.settings,
      mockConfig,
    );
    this.unitPass.setLocalPlayer(1);

    const structureHeader: RendererConfig = {
      mapWidth: PREVIEW_MAP_DIM,
      mapHeight: PREVIEW_MAP_DIM,
      unitTypes: ALL_STRUCTURE_TYPES,
      players: [],
    } as unknown as RendererConfig;

    this.structurePass = new StructurePass(
      this.gl,
      structureHeader,
      this.paletteTex,
      this.effectTex,
      this.settings,
    );
    this.structurePass.setLocalPlayer(1);

    this.trailPass = new TrailPass(
      this.gl,
      PREVIEW_MAP_DIM,
      PREVIEW_MAP_DIM,
      this.trailTex,
      this.paletteTex,
      this.effectTex,
      this.settings,
    );
    this.trailPass.setLiveRef(this.liveTrailData);

    this.spiralPass = new SpiralRibbonPass(this.gl, this.settings);
    this.fxPass = new FxPass(
      this.gl,
      rendererHeader,
      this.settings,
      mockConfig,
    );

    this.ticker = new PreviewAnimationTicker({ mode: "SKIN" });

    this.applyCameraPreset("SKIN");
  }

  private toRgb01(
    colors?: readonly string[],
  ): readonly (readonly [number, number, number])[] {
    return (colors ?? []).map((hex) => {
      const rgb = hexToRgb(hex) ?? [255, 255, 255];
      return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255] as const;
    });
  }

  setCosmetic(config: CosmeticPreviewConfig): void {
    if (this.isDisposed) return;
    this.currentConfig = config;
    this.currentMode = config.mode;
    this.explosionParams = config.explosionParams;
    this.fxPass.clear();
    this.lastUnitTick = -1;
    this.updateEffectTexture(config);

    const nextPreset = this.resolveTerrainPreset(config.mode);
    if (nextPreset !== this.currentPreset) {
      this.currentPreset = nextPreset;
      const mapData = generatePreviewMap(nextPreset);
      this.terrainPass.dispose();
      this.terrainPass = new TerrainPass(
        this.gl,
        () => mapData.terrainBytes,
        mapData.terrainBytes,
        mapData.mapW,
        mapData.mapH,
      );
      this.territoryPass.setTileState(mapData.tileState);
    }

    this.applyCameraPreset(config.mode);

    const rgbColors = this.toRgb01(config.effectColors);

    if (config.mode === "SKIN") {
      const isPngSkin = config.skinUrl !== undefined;
      this.territoryPass.setDecoration(config.skinUrl, config.patternData);
      // A team color on a PNG skin tints it like a team game; a pattern's
      // palette becomes the player's fill + border colors.
      this.territoryPass.setTeamMode(isPngSkin && rgbColors.length > 0);
      this.updatePalette(rgbColors[0], rgbColors[1]);
    } else {
      this.updatePalette();
    }
    this.structurePass.setHighlightOwner(config.mode === "BUILDING" ? 1 : 0);

    const explosionDurationSec = config.explosionParams
      ? calculateExplosionDurationMs(config.explosionParams, 1500) / 1000
      : undefined;

    this.ticker = new PreviewAnimationTicker({
      mode: config.mode,
      cosmeticUnitType: config.cosmeticUnitType,
      structureLevel: config.structureLevel,
      explosionDurationSec,
      salvoMode: config.salvoMode,
      spiralParams:
        (config.mode === "NUKE_MISSILE_TRAIL" ||
          config.mode === "MIRV_CLUSTER") &&
        config.spiralRadius !== undefined
          ? {
              radius: config.spiralRadius ?? 3,
              strands: config.spiralStrands ?? 2,
              rotationSpeed: config.spiralSpeed ?? 6,
              colors: rgbColors.length > 0 ? rgbColors : [[0.2, 0.9, 0.3]],
            }
          : null,
    });
  }

  get zoom(): number {
    return this.camera.zoom;
  }

  pan(deltaWorldX: number, deltaWorldY: number): void {
    this.camera.panBy(deltaWorldX, deltaWorldY);
  }

  resetCamera(): void {
    this.applyCameraPreset(this.currentMode);
  }

  setPreviewColors(colors: readonly string[]): void {
    if (!this.currentConfig) return;
    this.currentConfig = { ...this.currentConfig, effectColors: colors };
    this.setCosmetic(this.currentConfig);
  }

  setSalvoMode(enabled: boolean): void {
    if (!this.currentConfig) return;
    this.currentConfig = { ...this.currentConfig, salvoMode: enabled };
    this.setCosmetic(this.currentConfig);
  }

  zoomBy(factor: number): void {
    this.camera.zoomTo(this.camera.zoom * factor);
  }

  zoomTo(level: number): void {
    this.camera.zoomTo(level);
  }

  zoomAtScreen(factor: number, screenX: number, screenY: number): void {
    this.camera.zoomAtScreen(factor, screenX, screenY);
  }

  render(now: number): void {
    if (this.isDisposed) return;
    const gl = this.gl;

    const dpr = renderDpr();
    const cssW = Math.max(1, this.canvas.clientWidth);
    const cssH = Math.max(1, this.canvas.clientHeight);
    const displayW = Math.round(cssW * dpr);
    const displayH = Math.round(cssH * dpr);

    if (this.canvas.width !== displayW || this.canvas.height !== displayH) {
      this.canvas.width = displayW;
      this.canvas.height = displayH;
      this.camera.resize(cssW, cssH);
      if (!this.initialized) {
        this.initialized = true;
        this.applyCameraPreset(this.currentMode);
      }
    }

    if (this.canvas.clientWidth <= 0 || this.canvas.clientHeight <= 0) return;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    // In-game ocean clear color
    gl.clearColor(0.08, 0.12, 0.18, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const snapshot = this.ticker.sample(now);
    const camMat = this.camera.getMatrix();

    if (snapshot.isNewCycle) {
      this.fxPass.clear();
    }

    if (snapshot.detonationEvents.length > 0) {
      this.fxPass.applyDeadUnits(
        snapshot.detonationEvents.map((evt) => ({
          unitType: evt.unitType,
          pos: Math.floor(evt.y) * PREVIEW_MAP_DIM + Math.floor(evt.x),
          ownerSmallID: 1,
          reachedTarget: true,
          explosion: this.explosionParams,
          tickAge: 0,
        })),
      );
    }

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    this.terrainPass.draw(camMat);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    if (this.currentMode === "SKIN") {
      this.territoryPass.draw(camMat);
    }

    this.renderTrails(snapshot, camMat);
    this.renderUnits(snapshot, camMat, now);

    // Update and draw explosion FX instance buffers
    this.fxPass.tick();
    this.fxPass.draw(camMat, this.camera.zoom);
  }

  /**
   * Renders boat wakes and missile trails using WebGL trail pass.
   * Optimizes CPU throughput by clearing only previously modified indices
   * rather than re-zeroing the entire 512x512 buffer on every frame.
   */
  private renderTrails(
    snapshot: PreviewAnimationSnapshot,
    camMat: Float32Array,
  ): void {
    for (const idx of this.lastActiveTrailIndices) {
      this.liveTrailData[idx] = 0;
    }
    this.lastActiveTrailIndices.length = 0;

    if (snapshot.trailPoints.length > 0) {
      for (const pt of snapshot.trailPoints) {
        const idx = Math.floor(pt.y) * PREVIEW_MAP_DIM + Math.floor(pt.x);
        if (idx >= 0 && idx < this.liveTrailData.length) {
          const ownerBits = 1 & 0x0fff;
          const flagBits = pt.isNuke ? 1 << 12 : 0;
          this.liveTrailData[idx] = ownerBits | flagBits;
          this.lastActiveTrailIndices.push(idx);
        }
      }
      this.trailPass.setLiveRef(this.liveTrailData);
      this.trailPass.draw(camMat);
    } else {
      this.trailPass.setLiveRef(this.liveTrailData);
      this.trailPass.flushTexture();
    }
    if (snapshot.spiralRibbons.length > 0) {
      this.spiralPass.updateRibbons(snapshot.spiralRibbons);
      this.spiralPass.draw(camMat);
    }
  }

  private renderUnits(
    snapshot: PreviewAnimationSnapshot,
    camMat: Float32Array,
    now: number,
  ): void {
    this.unitMap.clear();
    for (const u of snapshot.units) {
      this.unitMap.set(u.id, u);
    }

    if (this.currentMode === "BUILDING" || this.currentMode === "SKIN") {
      this.structurePass.updateStructures(this.unitMap);
      this.structurePass.draw(camMat, this.camera.zoom);
      return;
    }
    const tick = Math.floor(now / PREVIEW_TICK_MS);
    if (tick !== this.lastUnitTick) {
      // Units advance once per simulated tick, as in a match: UnitPass lerps
      // missiles lastPos→pos between ticks, and the flicker hash re-rolls per
      // tick instead of every frame.
      this.lastUnitTick = tick;
      this.frameTick++;
      this.unitPass.setFrameTick(this.frameTick);
      this.unitPass.updateUnits(this.unitMap, tick);
    }
    if (snapshot.units.length > 0) {
      this.unitPass.drawGround(camMat);
      this.unitPass.drawMissiles(camMat);
    }
  }

  private resolveTerrainPreset(
    mode: CosmeticPreviewMode,
  ): PreviewTerrainPreset {
    switch (mode) {
      case "WARSHIP_BOAT_TRAIL":
        return "OPEN_OCEAN";
      case "BUILDING":
        return "COASTAL_BASEPLATE";
      case "SKIN":
      case "NUKE_MISSILE_TRAIL":
      case "MIRV_CLUSTER":
      case "NUKE_EXPLOSION":
      default:
        return "CONTINENTAL_ARCHIPELAGO";
    }
  }

  private applyCameraPreset(mode: CosmeticPreviewMode): void {
    const center = PREVIEW_MAP_DIM / 2;
    let zoom: number;
    switch (mode) {
      case "WARSHIP_BOAT_TRAIL":
        zoom = 4.4;
        break;
      case "BUILDING":
        zoom = 2.4;
        break;
      case "NUKE_MISSILE_TRAIL":
      case "NUKE_EXPLOSION":
      case "MIRV_CLUSTER":
        zoom = 1.35;
        break;
      case "SKIN":
      default:
        zoom = 1.0;
        break;
    }
    this.camera.setCameraState(center, center, zoom);
  }

  private createPaletteTexture(): WebGLTexture {
    this.writePaletteEntry(DEFAULT_FILL, DEFAULT_BORDER);
    return createTexture2D(this.gl, {
      width: getPaletteSize(),
      height: 2,
      internalFormat: this.gl.RGBA32F,
      format: this.gl.RGBA,
      type: this.gl.FLOAT,
      data: this.paletteData,
      filter: this.gl.NEAREST,
    });
  }

  /** Same layout as WebGLFrameBuilder.writePaletteEntry: row 0 = fill, row 1 = border. */
  private writePaletteEntry(
    fill: readonly [number, number, number],
    border: readonly [number, number, number],
  ): void {
    const data = this.paletteData;
    const fillOff = PREVIEW_OWNER_ID * 4;
    data[fillOff] = fill[0];
    data[fillOff + 1] = fill[1];
    data[fillOff + 2] = fill[2];
    data[fillOff + 3] = 150 / 255;
    const borderOff = getPaletteSize() * 4 + PREVIEW_OWNER_ID * 4;
    data[borderOff] = border[0];
    data[borderOff + 1] = border[1];
    data[borderOff + 2] = border[2];
    data[borderOff + 3] = 1.0;
  }

  /** Recolor the preview player (undefined = default colors) and re-upload the palette. */
  private updatePalette(
    fill?: readonly [number, number, number],
    border?: readonly [number, number, number],
  ): void {
    const f = fill ?? DEFAULT_FILL;
    const b =
      border ?? (fill ? [f[0] * 0.6, f[1] * 0.6, f[2] * 0.6] : DEFAULT_BORDER);
    this.writePaletteEntry(f, b);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      getPaletteSize(),
      2,
      gl.RGBA,
      gl.FLOAT,
      this.paletteData,
    );
  }

  private createEffectTexture(): WebGLTexture {
    const width = getPaletteSize();
    const height = MAX_TRAIL_COLORS * EFFECT_PALETTE_BLOCKS;
    const data = new Float32Array(width * height * 4);

    return createTexture2D(this.gl, {
      width,
      height,
      internalFormat: this.gl.RGBA32F,
      format: this.gl.RGBA,
      type: this.gl.FLOAT,
      data,
      filter: this.gl.NEAREST,
    });
  }

  private updateEffectTexture(config: CosmeticPreviewConfig): void {
    const width = getPaletteSize();
    const height = MAX_TRAIL_COLORS * EFFECT_PALETTE_BLOCKS;
    this.effectBuffer.fill(0);
    const data = this.effectBuffer;

    const colors = this.toRgb01(config.effectColors);

    const ownerID = 1;
    const speed = config.movementSpeed ?? 20.0;
    const colorSize = config.colorSize ?? 6.0;
    const freq = config.frequency ?? 2.0;

    const fillBlock = (blockIndex: number, isCosmeticActive: boolean) => {
      const rowBase = blockIndex * MAX_TRAIL_COLORS;
      const count = isCosmeticActive ? colors.length : 0;

      for (let r = 0; r < MAX_TRAIL_COLORS; r++) {
        const col = count > 0 ? colors[r % count] : [0.95, 0.95, 0.95];
        const pixelIdx = (rowBase + r) * width + ownerID;
        const off = pixelIdx * 4;

        data[off + 0] = col[0];
        data[off + 1] = col[1];
        data[off + 2] = col[2];

        if (r === 0) {
          data[off + 3] = count; // Color count (0 = default/solid static, >0 = cosmetic active)
        } else if (r === 1) {
          data[off + 3] = config.frequency !== undefined ? 1.0 : 0.0;
        } else if (r === 2) {
          data[off + 3] = config.frequency !== undefined ? freq : colorSize;
        } else if (r === 3) {
          data[off + 3] = count > 0 ? speed : 0.0; // 0 for static default
        } else {
          data[off + 3] = 1.0;
        }
      }
    };

    // Transport wakes and warship hulls are separate cosmetic slots in-game,
    // so only the block for the unit being previewed lights up.
    const isBoatMode = config.mode === "WARSHIP_BOAT_TRAIL";
    const isTransportActive =
      isBoatMode && config.cosmeticUnitType === UT_TRANSPORT;
    const isWarshipActive =
      isBoatMode && config.cosmeticUnitType === UT_WARSHIP;
    const isNukeTrailActive = config.mode === "NUKE_MISSILE_TRAIL";
    const isStructActive = config.mode === "BUILDING";

    fillBlock(0, isTransportActive); // transport/boat wake (Block 0)
    fillBlock(1, isNukeTrailActive); // nuke/missile trail (Block 1)
    fillBlock(STRUCTURES_EFFECT_BLOCK, isStructActive);
    fillBlock(WARSHIP_EFFECT_BLOCK, isWarshipActive);

    this.gl.bindTexture(this.gl.TEXTURE_2D, this.effectTex);
    this.gl.texSubImage2D(
      this.gl.TEXTURE_2D,
      0,
      0,
      0,
      width,
      height,
      this.gl.RGBA,
      this.gl.FLOAT,
      data,
    );
  }

  private createTrailTexture(): WebGLTexture {
    return createTexture2D(this.gl, {
      width: PREVIEW_MAP_DIM,
      height: PREVIEW_MAP_DIM,
      internalFormat: this.gl.R16UI,
      format: this.gl.RED_INTEGER,
      type: this.gl.UNSIGNED_SHORT,
      data: null,
      filter: this.gl.NEAREST,
    });
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    const gl = this.gl;
    gl.deleteTexture(this.paletteTex);
    gl.deleteTexture(this.effectTex);
    gl.deleteTexture(this.trailTex);

    this.terrainPass.dispose();
    this.territoryPass.dispose();
    this.unitPass.dispose();
    this.structurePass.dispose();
    this.trailPass.dispose();
    this.spiralPass.dispose();
    this.fxPass.dispose();
  }
}
