/**
 * CosmeticPreviewRenderer — lightweight WebGL2 renderer for in-game store cosmetic previewing.
 */

import type { Config } from "../../../core/configuration/Config";
import type { SpiralParams } from "../frame/SpiralTrails";
import { Camera } from "../gl/Camera";
import { initGL } from "../gl/initGL";
import { calculateExplosionDurationMs, FxPass } from "../gl/passes/fx-pass";
import { RailroadPass } from "../gl/passes/RailroadPass";
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
  RAILROAD_EFFECT_BLOCK,
  STRUCTURES_EFFECT_BLOCK,
  TRAIN_EFFECT_BLOCK,
  WARSHIP_EFFECT_BLOCK,
} from "../gl/utils/ColorUtils";
import { renderDpr } from "../gl/utils/Dpr";
import {
  EFFECT_ENTRY_FLOATS,
  packEffectEntry,
  type PaletteEffectAttributes,
  parseEffectColors,
} from "../gl/utils/EffectPalette";
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
  getPreviewRailLoop,
  PREVIEW_MAP_H,
  PREVIEW_MAP_W,
  PREVIEW_SCENE,
  type PreviewMapData,
} from "./PreviewMap";

export interface CosmeticPreviewConfig {
  mode: CosmeticPreviewMode;
  cosmeticUnitType?: string;
  structureLevel?: number;
  skinUrl?: string;
  patternData?: string;
  /** Skin/pattern palette: [fill, border] (a single team color tints a PNG skin). */
  effectColors?: readonly string[];
  /** Catalog attributes of a palette-rendered effect, packed exactly as in-game. */
  effectAttributes?: PaletteEffectAttributes;
  explosionParams?: NukeExplosionRenderParams;
  salvoMode?: boolean;
}

/** Simulated tick length — units advance and flicker once per tick, as in a match. */
const PREVIEW_TICK_MS = 100;

const DEFAULT_FILL: readonly [number, number, number] = [0.2, 0.6, 0.95];
const DEFAULT_BORDER: readonly [number, number, number] = [0.1, 0.35, 0.7];
/** In-game local rail color over a non-bright territory (theme focusedBorderColor). */
const LOCAL_RAIL_COLOR: readonly [number, number, number] = [0.9, 0.9, 0.9];

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
  private liveTrailData = new Uint16Array(PREVIEW_MAP_W * PREVIEW_MAP_H);
  private lastActiveTrailIndices: number[] = [];
  private effectBuffer = new Float32Array(
    getPaletteSize() * MAX_TRAIL_COLORS * EFFECT_PALETTE_BLOCKS * 4,
  );
  private effectEntryScratch = new Float32Array(EFFECT_ENTRY_FLOATS);

  private terrainPass: TerrainPass;
  private territoryPass: PreviewTerritoryPass;
  private railroadPass: RailroadPass;
  private unitPass: UnitPass;
  private structurePass: StructurePass;
  private trailPass: TrailPass;
  private spiralPass: SpiralRibbonPass;
  private fxPass: FxPass;

  private ticker: PreviewAnimationTicker;
  private currentMode: CosmeticPreviewMode = "SKIN";
  private currentConfig?: CosmeticPreviewConfig;
  private explosionParams?: NukeExplosionRenderParams;
  private isDisposed = false;
  private initialized = false;
  private frameTick = 0;
  private lastUnitTick = -1;

  private unitMap = new Map<number, UnitState>();
  private structureMap = new Map<number, UnitState>();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    map: PreviewMapData,
  ) {
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
    this.camera = new Camera(PREVIEW_MAP_W, PREVIEW_MAP_H);

    this.paletteTex = this.createPaletteTexture();
    this.effectTex = this.createEffectTexture();
    this.trailTex = this.createTrailTexture();

    this.terrainPass = new TerrainPass(
      this.gl,
      () => map.terrainBytes,
      map.terrainBytes,
      map.mapW,
      map.mapH,
    );

    this.territoryPass = new PreviewTerritoryPass(
      this.gl,
      map.mapW,
      map.mapH,
      this.paletteTex,
      this.settings,
      map.tileState,
      PREVIEW_SCENE.land,
    );
    this.railroadPass = this.createRailroadPass(map.terrainBytes);

    const rendererHeader: RendererConfig = {
      mapWidth: PREVIEW_MAP_W,
      mapHeight: PREVIEW_MAP_H,
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
      mapWidth: PREVIEW_MAP_W,
      mapHeight: PREVIEW_MAP_H,
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
      PREVIEW_MAP_W,
      PREVIEW_MAP_H,
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
    this.applyConfig(config, true);
  }

  /** Apply a config; `resetCamera` re-frames the scene for its mode. */
  private applyConfig(
    config: CosmeticPreviewConfig,
    resetCamera: boolean,
  ): void {
    if (this.isDisposed) return;
    this.currentConfig = config;
    this.currentMode = config.mode;
    this.explosionParams = config.explosionParams;
    this.fxPass.clear();
    this.lastUnitTick = -1;
    this.updateEffectTexture(config);

    if (resetCamera) this.applyCameraPreset(config.mode);

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
      spiralParams: this.spiralParams(config),
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

  /** Swap in user-picked colors (skin palette, or an effect's color list); keeps the camera. */
  setPreviewColors(colors: readonly string[]): void {
    if (!this.currentConfig) return;
    const attrs = this.currentConfig.effectAttributes;
    this.applyConfig(
      attrs
        ? {
            ...this.currentConfig,
            effectAttributes: { ...attrs, colors: [...colors] },
          }
        : { ...this.currentConfig, effectColors: colors },
      false,
    );
  }

  /** Spiral nuke trails render as ribbon geometry, like SpiralTrails in-game. */
  private spiralParams(config: CosmeticPreviewConfig): SpiralParams | null {
    const attrs = config.effectAttributes;
    if (
      (config.mode !== "NUKE_MISSILE_TRAIL" &&
        config.mode !== "MIRV_CLUSTER") ||
      attrs?.type !== "spiral"
    ) {
      return null;
    }
    const colors = parseEffectColors(attrs.colors);
    if (colors.length === 0) return null;
    return {
      radius: attrs.radius,
      strands: attrs.strands,
      rotationSpeed: attrs.rotationSpeed,
      colors,
    };
  }

  setSalvoMode(enabled: boolean): void {
    if (!this.currentConfig) return;
    this.applyConfig({ ...this.currentConfig, salvoMode: enabled }, false);
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
          pos: Math.floor(evt.y) * PREVIEW_MAP_W + Math.floor(evt.x),
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

    if (this.drawsTerritory(this.currentMode)) {
      this.territoryPass.draw(camMat);
    }
    if (this.currentMode === "TRAIN" || this.currentMode === "RAILROAD") {
      this.railroadPass.draw(camMat, this.camera.zoom);
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
        const idx = Math.floor(pt.y) * PREVIEW_MAP_W + Math.floor(pt.x);
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
    const structures = snapshot.structures ?? [];
    if (structures.length > 0) {
      this.structureMap.clear();
      for (const u of structures) {
        this.structureMap.set(u.id, u);
      }
      this.structurePass.updateStructures(this.structureMap);
      this.structurePass.draw(camMat, this.camera.zoom);
    }

    this.unitMap.clear();
    for (const u of snapshot.units) {
      this.unitMap.set(u.id, u);
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

  /** Owned-territory fill is part of the scene for skins and rail previews. */
  private drawsTerritory(mode: CosmeticPreviewMode): boolean {
    return mode === "SKIN" || mode === "TRAIN" || mode === "RAILROAD";
  }

  private createRailroadPass(terrainBytes: Uint8Array): RailroadPass {
    const pass = new RailroadPass(
      this.gl,
      PREVIEW_MAP_W,
      PREVIEW_MAP_H,
      this.territoryPass.tileTexture,
      this.paletteTex,
      this.effectTex,
      terrainBytes,
      this.settings,
    );
    pass.setLocalPlayer(PREVIEW_OWNER_ID);
    pass.setLocalRailColor(...LOCAL_RAIL_COLOR);
    pass.uploadRailroadState(getPreviewRailLoop().railroadState);
    return pass;
  }

  private applyCameraPreset(mode: CosmeticPreviewMode): void {
    let center: { x: number; y: number };
    let zoom: number;
    switch (mode) {
      case "WARSHIP_BOAT_TRAIL":
        center = PREVIEW_SCENE.ocean;
        zoom = 4.4;
        break;
      case "BUILDING":
        center = PREVIEW_SCENE.coast;
        zoom = 2.4;
        break;
      case "TRAIN":
      case "RAILROAD":
        // Above railDetailZoom so the rails draw as sprites, like up close in-game.
        center = PREVIEW_SCENE.land;
        zoom = 6.5;
        break;
      case "NUKE_MISSILE_TRAIL":
      case "NUKE_EXPLOSION":
      case "MIRV_CLUSTER":
        center = PREVIEW_SCENE.land;
        zoom = 1.35;
        break;
      case "SKIN":
      default:
        center = PREVIEW_SCENE.land;
        zoom = 1.0;
        break;
    }
    this.camera.setCameraState(center.x, center.y, zoom);
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

  /**
   * Effect-palette block the previewed effect lights up, or null when the
   * scene shows no palette effect. Mirrors the in-game consumers: transport
   * wakes (0) and warship hulls (WARSHIP) are separate slots, nuke and MIRV
   * warhead trails both carry the nuke bit (1).
   */
  private effectBlock(config: CosmeticPreviewConfig): number | null {
    switch (config.mode) {
      case "WARSHIP_BOAT_TRAIL":
        if (config.cosmeticUnitType === UT_TRANSPORT) return 0;
        if (config.cosmeticUnitType === UT_WARSHIP) return WARSHIP_EFFECT_BLOCK;
        return null;
      case "NUKE_MISSILE_TRAIL":
      case "MIRV_CLUSTER":
        return 1;
      case "BUILDING":
        return STRUCTURES_EFFECT_BLOCK;
      case "TRAIN":
        return TRAIN_EFFECT_BLOCK;
      case "RAILROAD":
        return RAILROAD_EFFECT_BLOCK;
      default:
        return null;
    }
  }

  private updateEffectTexture(config: CosmeticPreviewConfig): void {
    const width = getPaletteSize();
    const height = MAX_TRAIL_COLORS * EFFECT_PALETTE_BLOCKS;
    const data = this.effectBuffer;
    data.fill(0);

    const block = this.effectBlock(config);
    if (block !== null && config.effectAttributes) {
      const entry = this.effectEntryScratch;
      packEffectEntry(config.effectAttributes, entry);
      const rowBase = block * MAX_TRAIL_COLORS;
      for (let r = 0; r < MAX_TRAIL_COLORS; r++) {
        const off = ((rowBase + r) * width + PREVIEW_OWNER_ID) * 4;
        data.set(entry.subarray(r * 4, r * 4 + 4), off);
      }
    }

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
      width: PREVIEW_MAP_W,
      height: PREVIEW_MAP_H,
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
    this.railroadPass.dispose();
    this.unitPass.dispose();
    this.structurePass.dispose();
    this.trailPass.dispose();
    this.spiralPass.dispose();
    this.fxPass.dispose();

    // Deleting GL resources isn't enough — the context itself counts against
    // the browser's WebGL context limit until it's GC'd. Explicitly drop it so
    // repeatedly opening the preview modal doesn't overflow.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
