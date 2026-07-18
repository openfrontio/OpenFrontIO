/**
 * GPURenderer v2 — normalized render pipeline.
 *
 * Draw order:
 *   DATA SYNC: tile flush → heat update → border compute
 *   BASE PASS (darkened by night): terrain → territory fill + stale-nuke ground
 *   NIGHT COMPOSITE (optional): lightmap → scene × (ambient + lightmap)
 *   FULL BRIGHTNESS (always): borders → railroads → ground units → structures →
 *     structure levels → bars → bloom → trails → missiles → fx → conquest → names
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
import { Camera } from "./Camera";
import { BarPass } from "./passes/BarPass";
import { BorderComputePass } from "./passes/BorderComputePass";
import { BorderStampPass } from "./passes/BorderStampPass";
import { CoordinateGridPass } from "./passes/CoordinateGridPass";
import { CrosshairPass } from "./passes/CrosshairPass";
import { DefenseCoveragePass } from "./passes/DefenseCoveragePass";
import { FalloutBloomPass } from "./passes/FalloutBloomPass";
import { FalloutLightPass } from "./passes/FalloutLightPass";
import { FxPass } from "./passes/fx-pass";
import { LightmapPass } from "./passes/LightmapPass";
import { MoveIndicatorPass } from "./passes/MoveIndicatorPass";
import { NamePass } from "./passes/name-pass";
import { NightCompositePass } from "./passes/NightCompositePass";
import { NukeTelegraphPass } from "./passes/NukeTelegraphPass";
import { NukeTrajectoryPass } from "./passes/NukeTrajectoryPass";
import { PointLightPass } from "./passes/PointLightPass";
import { RailroadPass } from "./passes/RailroadPass";
import { RangeCirclePass } from "./passes/RangeCirclePass";
import { SAMRadiusPass } from "./passes/SamRadiusPass";
import { SelectionBoxPass } from "./passes/SelectionBoxPass";
import { SkinAtlasArray } from "./passes/SkinAtlasArray";
import { SmallPlayerGlowPass } from "./passes/SmallPlayerGlowPass";
import type { SpawnCenter } from "./passes/SpawnOverlayPass";
import { SpawnOverlayPass } from "./passes/SpawnOverlayPass";
import { StructureLevelPass } from "./passes/StructureLevelPass";
import { StructurePass } from "./passes/StructurePass";
import { TerrainPass } from "./passes/TerrainPass";
import { TerritoryPass } from "./passes/TerritoryPass";
import { TrailPass } from "./passes/TrailPass";
import { UnitPass } from "./passes/UnitPass";
import { WorldTextPass } from "./passes/WorldTextPass";
import type { RenderSettings } from "./RenderSettings";
import { AffiliationPalette } from "./utils/Affiliation";
import { getPaletteSize, hexToRgb } from "./utils/ColorUtils";
import { renderDpr } from "./utils/Dpr";
import {
  createTexture2D,
  toScreen,
  toTarget,
  type RenderTarget,
} from "./utils/GlUtils";
import {
  createGPUResources,
  disposeGPUResources,
  type GPUResources,
} from "./utils/GpuResources";
import { HeatManager } from "./utils/HeatManager";

/** Ghost types that trigger SAM radius overlay (matches upstream SAMRadiusLayer). */
const SAM_RADIUS_GHOST_TYPES = new Set([
  "Missile Silo",
  "SAM Launcher",
  "City",
  "Atom Bomb",
  "Hydrogen Bomb",
]);

/** Subset for build-button hover — excludes City/Silo (SAM radii irrelevant). */
const SAM_RADIUS_HIGHLIGHT_TYPES = new Set([
  "SAM Launcher",
  "Atom Bomb",
  "Hydrogen Bomb",
]);

const GRID_VIEW_KEY = "renderer:grid_view_enabled";

export class GPURenderer {
  private gl: WebGL2RenderingContext;
  private camera: Camera;
  private res: GPUResources;

  // Passes
  private terrainPass: TerrainPass;
  private territoryPass: TerritoryPass;
  private trailPass: TrailPass;
  private borderStampPass: BorderStampPass;
  private borderPass: BorderComputePass;
  private defenseCoveragePass: DefenseCoveragePass;
  private bloomPass: FalloutBloomPass;
  private pointLightPass: PointLightPass;
  private falloutLightPass: FalloutLightPass;
  private lightmapPass: LightmapPass;
  private nightCompositePass: NightCompositePass;
  private structurePass: StructurePass;
  private structureLevelPass: StructureLevelPass;
  private unitPass: UnitPass;
  private namePass: NamePass;
  private fxPass: FxPass;
  private rangeCirclePass: RangeCirclePass;
  private samRadiusPass: SAMRadiusPass;
  private crosshairPass: CrosshairPass;
  private railroadPass: RailroadPass;
  private barPass: BarPass;
  private worldTextPass: WorldTextPass;
  private selectionBoxPass: SelectionBoxPass;
  private moveIndicatorPass: MoveIndicatorPass;
  private nukeTrajectoryPass: NukeTrajectoryPass;
  private nukeTelegraphPass: NukeTelegraphPass;
  private heatManager: HeatManager;
  private affiliationPalette: AffiliationPalette;
  private coordinateGridPass: CoordinateGridPass;
  private spawnOverlayPass: SpawnOverlayPass;
  private smallPlayerGlowPass: SmallPlayerGlowPass;
  private inSpawnPhase = false;

  private paletteTex: WebGLTexture;
  private paletteData: Float32Array;
  private patternMetaTex: WebGLTexture;
  private patternDataTex: WebGLTexture;
  private skinAtlas: SkinAtlasArray;
  private skinLayerTex: WebGLTexture;
  /** CPU-side mirror of skinLayerTex (0 = no skin, otherwise layer + 1). */
  private skinLayerCpu: Uint8Array;
  /** Per-player anchor (x,y) for skin sampling. (0,0) = world-origin anchor. */
  private skinAnchorTex: WebGLTexture;
  private skinAnchorCpu: Uint16Array;
  private canvas: HTMLCanvasElement;
  private settings: RenderSettings;
  private sceneTarget: RenderTarget;
  private raf: typeof requestAnimationFrame;
  private caf: typeof cancelAnimationFrame;

  private animId: number | null = null;
  private frameTick = 0;
  private mapW = 0;
  private mapH = 0;

  // Last-uploaded unit/structure maps (selection box + bar pass inputs)
  private lastUnits: Map<number, UnitState> = new Map();
  private lastStructures: Map<number, UnitState> = new Map();

  // Local player relationship data (for SAM radius coloring)
  private localPlayerID = 0;
  private playerTeams = new Map<number, string>(); // smallID → team

  // Alt-view: affiliation recoloring (space hold)
  private altView = false;
  // Grid-view: coordinate grid overlay (M toggle)
  private gridView = false;

  // SAM radius visibility tracking (show if either source is true)
  private samGhostVisible = false;
  private samHighlightVisible = false;

  // Warship selection — supports any number of selections.
  private selectedUnitIds: number[] = [];
  /** Reusable scratch buffer of {x,y,r,g,b} for the selection-box pass. */
  private readonly selectionBoxEntries: import("./passes/SelectionBoxPass").SelectionEntry[] =
    [];

  constructor(
    canvas: HTMLCanvasElement,
    header: RendererConfig,
    terrainBytes: Uint8Array,
    paletteData: Float32Array,
    config: Config,
    settings: RenderSettings,
    raf: typeof requestAnimationFrame = requestAnimationFrame.bind(window),
    caf: typeof cancelAnimationFrame = cancelAnimationFrame.bind(window),
  ) {
    this.canvas = canvas;
    // Settings are resolved (defaults + user overrides) by the caller and
    // passed in, so every pass — including texture-baking ones like terrain —
    // is built with the final values. Live changes mutate this object in place.
    this.settings = settings;
    this.raf = raf;
    this.caf = caf;

    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("WebGL2 not supported");
    this.gl = gl;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    const floatExt = gl.getExtension("EXT_color_buffer_float");
    if (!floatExt)
      console.warn("EXT_color_buffer_float not available — palette may fail");

    const mapW = header.mapWidth;
    const mapH = header.mapHeight;
    this.mapW = mapW;
    this.mapH = mapH;

    this.camera = new Camera(mapW, mapH);

    // --- Terrain (static) ---
    this.terrainPass = new TerrainPass(
      gl,
      terrainBytes,
      mapW,
      mapH,
      hexToRgb(this.settings.terrain.oceanColor) ?? undefined,
    );

    // --- Shared palette texture (RGBA32F, 4096×2) ---
    this.paletteData = paletteData;
    const palW = getPaletteSize();
    this.paletteTex = createTexture2D(gl, {
      width: palW,
      height: 2,
      internalFormat: gl.RGBA32F,
      format: gl.RGBA,
      type: gl.FLOAT,
      data: paletteData,
      filter: gl.NEAREST,
    });

    this.patternMetaTex = createTexture2D(gl, {
      width: palW,
      height: 1,
      internalFormat: gl.RGBA32F,
      format: gl.RGBA,
      type: gl.FLOAT,
      data: new Float32Array(palW * 4),
      filter: gl.NEAREST,
    });

    this.patternDataTex = createTexture2D(gl, {
      width: 1024,
      height: palW,
      internalFormat: gl.R8UI,
      format: gl.RED_INTEGER,
      type: gl.UNSIGNED_BYTE,
      data: new Uint8Array(palW * 1024),
      filter: gl.NEAREST,
    });

    // --- Skin atlas (TEXTURE_2D_ARRAY of PNG layers) + per-player layer map ---
    this.skinLayerCpu = new Uint8Array(palW);
    this.skinLayerTex = createTexture2D(gl, {
      width: palW,
      height: 1,
      internalFormat: gl.R8UI,
      format: gl.RED_INTEGER,
      type: gl.UNSIGNED_BYTE,
      data: this.skinLayerCpu,
      filter: gl.NEAREST,
    });
    // Per-player skin anchor: RG16UI, 2× uint16 per player → 4 bytes each.
    // (0,0) sentinel means "no anchor" — shader uses world origin.
    this.skinAnchorCpu = new Uint16Array(palW * 2);
    this.skinAnchorTex = createTexture2D(gl, {
      width: palW,
      height: 1,
      internalFormat: gl.RG16UI,
      format: gl.RG_INTEGER,
      type: gl.UNSIGNED_SHORT,
      data: this.skinAnchorCpu,
      filter: gl.NEAREST,
    });
    // Construct with no URLs — the real atlas is built once initSkinAtlas() is
    // called with the locked-in player skin URLs at game start.
    this.skinAtlas = new SkinAtlasArray(gl, [], () => {});

    // --- Border compute (creates its own borderTex) ---
    // Need a temporary tileTex reference for border compute — we'll create
    // GPUResources first, then wire everything.
    // But borderPass creates its own borderTex internally, so we need to
    // create GPUResources with it. Let's sequence carefully:

    // 1. Create GPUResources (creates tileTex, trailTex, heatTexA/B)
    //    borderTex placeholder — we'll get it from borderPass
    //    First create a dummy, then replace after borderPass is created.

    // Actually: borderPass creates its own internal borderTex (RGBA8).
    // We need tileTex to exist before borderPass. So:
    //   a) Create shared resources (tileTex, trailTex, heatA/B)
    //   b) Create borderPass with tileTex → gives us borderTex
    //   c) Store borderTex in res

    // Create shared textures except borderTex
    this.res = createGPUResources(gl, mapW, mapH, this.paletteTex, null!);

    // --- Border compute (needs tileTex) ---
    this.borderPass = new BorderComputePass(
      gl,
      mapW,
      mapH,
      this.res.tileTex,
      this.settings,
    );
    this.res.borderTex = this.borderPass.getBorderTex();

    // --- Defense coverage (needs tileTex) — per-tile "defended by same-owner
    // post" flag, stamped one instanced circle per post. Replaces the old
    // 64-cap uniform loop; consumed by BorderStampPass. ---
    this.defenseCoveragePass = new DefenseCoveragePass(
      gl,
      mapW,
      mapH,
      this.res.tileTex,
      this.settings,
    );

    // --- Heat manager (needs tileTex, heatTexA/B) ---
    this.heatManager = new HeatManager(
      gl,
      mapW,
      mapH,
      this.res.tileTex,
      this.res.heatTexA,
      this.res.heatTexB,
      this.settings,
    );

    // --- Territory (needs tileTex, paletteTex, patternTexs, skinTexs) ---
    this.territoryPass = new TerritoryPass(
      gl,
      mapW,
      mapH,
      this.res.tileTex,
      this.paletteTex,
      this.patternMetaTex,
      this.patternDataTex,
      this.skinAtlas.texture,
      this.skinLayerTex,
      this.skinAnchorTex,
      this.settings,
    );
    // Route per-tile changes to the border pass so it can scatter-recompute
    // just the affected tiles instead of rebuilding the whole map. A tile
    // changing owner can also flip its defense-coverage flag (same-owner test),
    // so mark the coverage stale too — one coalesced re-stamp happens per frame.
    this.territoryPass.setBorderPatchConsumer((x, y, prevOwner, newOwner) => {
      this.borderPass.patchTile(x, y, prevOwner, newOwner);
      this.defenseCoveragePass.markTileDirty(x, y);
    });
    // Territory fill darkens on interior tiles defended by a same-owner post;
    // borderTex lets the fill skip border tiles (those get the checkerboard).
    this.territoryPass.setDefenseCoverageTex(
      this.defenseCoveragePass.getCoverageTex(),
    );
    this.territoryPass.setBorderTex(this.res.borderTex);

    // --- Spawn overlay (needs tileTex) ---
    this.spawnOverlayPass = new SpawnOverlayPass(
      gl,
      mapW,
      mapH,
      this.res.tileTex,
      this.settings.spawnOverlay,
    );

    this.smallPlayerGlowPass = new SmallPlayerGlowPass(
      gl,
      mapW,
      mapH,
      this.res.tileTex,
      this.settings.smallPlayerGlow,
    );

    // --- Trail (needs trailTex, paletteTex) ---
    this.trailPass = new TrailPass(
      gl,
      mapW,
      mapH,
      this.res.trailTex,
      this.paletteTex,
      this.settings,
    );

    // --- Border stamp (needs tileTex, paletteTex, borderTex) ---
    this.borderStampPass = new BorderStampPass(
      gl,
      mapW,
      mapH,
      this.res.tileTex,
      this.paletteTex,
      this.res.borderTex,
      this.settings,
    );
    this.borderStampPass.setDefenseCoverageTex(
      this.defenseCoveragePass.getCoverageTex(),
    );

    // --- Fallout bloom (needs tileTex, heatManager) ---
    this.bloomPass = new FalloutBloomPass(
      gl,
      mapW,
      mapH,
      this.res.tileTex,
      this.heatManager,
      this.settings,
    );

    // --- Point lights ---
    this.pointLightPass = new PointLightPass(
      gl,
      header,
      paletteData,
      this.settings,
      config,
    );

    // --- Fallout light (needs tileTex + heatManager; particle flicker is
    //     computed inline using the falloutBloom particle settings) ---
    this.falloutLightPass = new FalloutLightPass(
      gl,
      mapW,
      mapH,
      this.res.tileTex,
      this.heatManager,
      this.settings,
    );

    // --- Lightmap orchestrator ---
    this.lightmapPass = new LightmapPass(
      gl,
      mapW,
      mapH,
      this.pointLightPass,
      this.falloutLightPass,
      this.settings,
    );

    // --- Night composite ---
    this.nightCompositePass = new NightCompositePass(gl, this.settings);

    // --- Railroad (needs tileTex) ---
    this.railroadPass = new RailroadPass(
      gl,
      mapW,
      mapH,
      this.res.tileTex,
      this.paletteTex,
      terrainBytes,
      this.settings,
    );

    // --- Range circle (ghost preview radius) ---
    this.rangeCirclePass = new RangeCirclePass(gl);

    // --- SAM radius overlay (dashed green circles during build mode) ---
    this.samRadiusPass = new SAMRadiusPass(gl, mapW, this.settings);
    this.samRadiusPass.setPaletteData(paletteData);

    // --- Crosshair (warship placement) ---
    this.crosshairPass = new CrosshairPass(gl);

    // --- Remaining passes (unchanged from v1) ---
    this.structurePass = new StructurePass(
      gl,
      header,
      this.paletteTex,
      this.settings,
    );
    this.structureLevelPass = new StructureLevelPass(gl, header, this.settings);
    this.unitPass = new UnitPass(
      gl,
      header,
      this.paletteTex,
      this.settings,
      config,
    );
    this.namePass = new NamePass(
      gl,
      header,
      paletteData,
      this.settings,
      config,
    );
    this.fxPass = new FxPass(gl, header, this.settings, config);
    this.barPass = new BarPass(gl, header, this.settings, config);
    this.worldTextPass = new WorldTextPass(gl, this.settings, config);
    this.worldTextPass.setMapWidth(this.mapW);
    this.selectionBoxPass = new SelectionBoxPass(gl);
    this.moveIndicatorPass = new MoveIndicatorPass(gl, this.settings);
    this.nukeTrajectoryPass = new NukeTrajectoryPass(gl, this.settings);
    this.nukeTelegraphPass = new NukeTelegraphPass(gl, this.settings);

    // --- Scene capture target (for night composite) ---
    const sceneTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const sceneFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      sceneTex,
      0,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.sceneTarget = { fbo: sceneFbo, tex: sceneTex, w: 1, h: 1 };

    // --- Alt-view passes ---
    this.affiliationPalette = new AffiliationPalette(gl, this.settings);
    const affTex = this.affiliationPalette.getTexture();
    this.borderStampPass.setAffiliationTex(affTex);
    this.unitPass.setAffiliationTex(affTex);
    this.structurePass.setAffiliationTex(affTex);
    this.trailPass.setAffiliationTex(affTex);
    this.coordinateGridPass = new CoordinateGridPass(
      gl,
      mapW,
      mapH,
      this.settings,
    );
    try {
      this.gridView = window.localStorage.getItem(GRID_VIEW_KEY) === "true";
    } catch {
      this.setGridView(false);
    }

    for (const p of header.players) {
      if (p.team !== null) this.playerTeams.set(p.smallID, p.team);
    }
    // Team mode = any player has a team. Drives skin tint behavior:
    // FFA shows raw skin colors; teams multiply skin by team primary color.
    this.territoryPass.setTeamMode(this.playerTeams.size > 0);

    this.startLoop();
  }

  private renderLoop = (): void => {
    this.draw();
    this.animId = this.raf(this.renderLoop);
  };

  private startLoop(): void {
    this.animId ??= this.raf(this.renderLoop);
  }

  private stopLoop(): void {
    if (this.animId !== null) {
      this.caf(this.animId);
      this.animId = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Canvas / Camera
  // ---------------------------------------------------------------------------

  resize(cssWidth: number, cssHeight: number): void {
    const dpr = renderDpr();
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    this.camera.resize(cssWidth, cssHeight);
  }

  setCameraState(x: number, y: number, z: number): void {
    this.camera.setCameraState(x, y, z);
  }

  // ---------------------------------------------------------------------------
  // Data upload
  // ---------------------------------------------------------------------------

  uploadTileAndTrailState(
    tileState: Uint16Array,
    trailState: Uint8Array,
  ): void {
    this.territoryPass.setLiveRef(tileState);
    this.trailPass.setLiveRef(trailState);
  }

  uploadLiveDelta(tileState: Uint16Array, changedTiles: TilePair[]): void {
    this.territoryPass.applyLiveDelta(tileState, changedTiles);
  }

  uploadLiveTrailDelta(
    trailState: Uint8Array,
    dirtyRowMin: number,
    dirtyRowMax: number,
  ): void {
    this.trailPass.applyLiveDelta(trailState, dirtyRowMin, dirtyRowMax);
  }

  /** Re-upload palette data to the GPU texture (e.g. when players appear after initial startup). */
  updatePalette(paletteData: Float32Array): void {
    const gl = this.gl;
    // Mutate the stored array in-place so all passes sharing the reference see the update.
    this.paletteData.set(paletteData);
    // Re-upload to the GPU texture
    gl.activeTexture(gl.TEXTURE0);
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
    // SAM radius pass stores its own copy
    this.samRadiusPass.setPaletteData(this.paletteData);
    // Name pass caches per-player colors and bakes them into slot rows
    this.namePass.refreshPlayerColors(this.paletteData);
  }

  /** Register late-arriving players (updates palette + NamePass lookup maps). */
  addPlayers(
    players: PlayerStatic[],
    paletteData: Float32Array,
    patternMeta: Float32Array,
    patternData: Uint8Array,
  ): void {
    this.updatePalette(paletteData);

    const gl = this.gl;
    const palW = getPaletteSize();

    gl.bindTexture(gl.TEXTURE_2D, this.patternMetaTex);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      palW,
      1,
      gl.RGBA,
      gl.FLOAT,
      patternMeta,
    );

    gl.bindTexture(gl.TEXTURE_2D, this.patternDataTex);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      1024,
      palW,
      gl.RED_INTEGER,
      gl.UNSIGNED_BYTE,
      patternData,
    );

    this.namePass.addPlayers(players, this.paletteData);
    for (const p of players) {
      if (p.team !== null) this.playerTeams.set(p.smallID, p.team);
    }
    // Renderer was constructed with players: [] (real list arrives via this
    // method), so team mode must be re-evaluated whenever new players arrive
    // — otherwise team games never enable the skin-tint branch.
    this.territoryPass.setTeamMode(this.playerTeams.size > 0);
  }

  /**
   * Anchor a player's skin sampling at world coords (x, y). The center of the
   * skin image lines up with this tile. Default (0,0) anchors at world origin.
   */
  setPlayerSpawn(smallID: number, x: number, y: number): void {
    const off = smallID * 2;
    this.skinAnchorCpu[off] = x;
    this.skinAnchorCpu[off + 1] = y;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.skinAnchorTex);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      getPaletteSize(),
      1,
      gl.RG_INTEGER,
      gl.UNSIGNED_SHORT,
      this.skinAnchorCpu,
    );
  }

  /**
   * Allocate the skin atlas to exactly `urls.length` layers. The player set is
   * locked at game start so this is called once with the complete URL list;
   * URLs not in this set will be ignored by `setPlayerSkin`.
   *
   * Layers are zero-initialized (browsers do this for security regardless of
   * the GL spec's "undefined" wording), so players whose images haven't
   * decoded yet render with alpha=0 → falls through to base player color.
   */
  initSkinAtlas(urls: readonly string[]): void {
    this.skinAtlas.dispose();
    this.skinAtlas = new SkinAtlasArray(this.gl, urls, () => {});
    this.territoryPass.setSkinAtlas(this.skinAtlas.texture);
  }

  /**
   * Map a player to a pre-registered skin layer. URLs not registered via
   * `initSkinAtlas` are silently dropped. If the image is still decoding the
   * layer renders transparent (zero-init) until decode completes.
   */
  setPlayerSkin(smallID: number, url: string): void {
    const layer = this.skinAtlas.getLayer(url);
    if (layer < 0) return;
    this.skinLayerCpu[smallID] = layer + 1;
    this.uploadSkinLayerTex();
  }

  private uploadSkinLayerTex(): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.skinLayerTex);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      getPaletteSize(),
      1,
      gl.RED_INTEGER,
      gl.UNSIGNED_BYTE,
      this.skinLayerCpu,
    );
  }

  uploadRailroadState(data: Uint8Array): void {
    this.railroadPass.uploadRailroadState(data);
  }

  updateUnits(units: Map<number, UnitState>, gameTick: number): void {
    this.lastUnits = units;
    this.frameTick++;
    this.unitPass.updateUnits(units, this.frameTick);
    this.barPass.updateBars(units, this.lastStructures, gameTick);
    this.pointLightPass.updateLights(units);
    this.heatManager.decayHeat();
  }

  updateNames(
    names: Map<string, NameEntry>,
    players: Map<number, PlayerState>,
    snap: boolean,
    statusData?: Map<number, PlayerStatusData>,
  ): void {
    this.namePass.updateNames(names, players, snap, statusData);

    // Extract local player's allies + teammates for SAM radius coloring
    if (this.localPlayerID > 0) {
      const localPS = players.get(this.localPlayerID);
      const friendly = new Set(localPS?.allies ?? []);
      const myTeam = this.playerTeams.get(this.localPlayerID);
      if (myTeam !== undefined) {
        for (const [sid, team] of this.playerTeams) {
          if (team === myTeam && sid !== this.localPlayerID) friendly.add(sid);
        }
      }
      this.samRadiusPass.setAllies(friendly);
      this.unitPass.setAllies(friendly);
    }
  }

  /** Re-resolve player name strings live (e.g. anonymous-names toggle). */
  refreshNames(displayNames: Map<string, string>): void {
    this.namePass.refreshNames(displayNames);
  }

  updateRelations(data: Uint8Array, size: number): void {
    this.borderPass.updateRelations(data, size);
    this.affiliationPalette.updateRelations(data, size);
  }

  updateStructures(units: Map<number, UnitState>): void {
    this.lastStructures = units;
    this.structurePass.updateStructures(units);
    this.structureLevelPass.updateStructures(units);
    this.samRadiusPass.updateStructures(units);
    this.unitPass.setStructures(units);
    const posts: { x: number; y: number; ownerID: number }[] = [];
    const w = this.mapW;
    for (const u of units.values()) {
      if (u.unitType === "Defense Post" && !u.underConstruction) {
        posts.push({
          x: u.pos % w,
          y: (u.pos - (u.pos % w)) / w,
          ownerID: u.ownerID,
        });
      }
    }
    this.defenseCoveragePass.updateDefensePosts(posts);
  }

  applyDeadUnits(deadUnits: DeadUnitFx[]): void {
    if (deadUnits.length > 0) this.fxPass.applyDeadUnits(deadUnits);
  }

  applyRailroadDust(tileRefs: number[]): void {
    if (tileRefs.length > 0) this.fxPass.applyRailroadDust(tileRefs);
  }

  /**
   * Update terrain texels for tiles whose terrain byte changed (e.g. water
   * nukes converting land → water). `terrainBytes[i]` is the new byte for
   * `refs[i]`. Forwards to both TerrainPass (RGBA color) and RailroadPass
   * (R8UI water-detection for bridges).
   */
  applyTerrainDelta(refs: readonly number[], terrainBytes: Uint8Array): void {
    if (refs.length === 0) return;
    this.terrainPass.applyTerrainDelta(refs, terrainBytes);
    this.railroadPass.applyTerrainDelta(refs, terrainBytes);
  }

  /**
   * Rebuild the terrain texture from the current `settings.terrain` colors.
   * Terrain is baked into a GPU texture rather than read per-frame, so a
   * settings change needs this explicit rebuild.
   */
  rebuildTerrain(): void {
    this.terrainPass.setOceanColor(
      hexToRgb(this.settings.terrain.oceanColor) ?? undefined,
    );
  }

  applyConquestEvents(events: ConquestFx[]): void {
    if (events.length > 0) {
      this.fxPass.applyConquestEvents(events);
      this.worldTextPass.applyConquestEvents(events);
    }
  }

  setAttackTroopLabels(
    labels: import("./passes/WorldTextPass").AttackTroopLabel[],
  ): void {
    this.worldTextPass.setAttackTroopLabels(labels);
  }

  applyBonusEvents(events: BonusEvent[]): void {
    if (events.length === 0) return;
    // In live game, filter to local player only. In replay (localPlayerID=0), show all.
    const filtered =
      this.localPlayerID > 0
        ? events.filter((e) => e.smallID === this.localPlayerID)
        : events;
    if (filtered.length > 0) this.worldTextPass.applyBonusEvents(filtered);
  }

  updateAttackRings(rings: AttackRingInput[]): void {
    this.fxPass.updateAttackRings(rings);
  }

  updateGhostPreview(data: GhostPreviewData | null): void {
    this.structurePass.updateGhostPreview(data);
    this.railroadPass.updateGhostPreview(data);
    this.rangeCirclePass.updateGhostPreview(data);
    this.crosshairPass.updateGhostPreview(data);
    this.worldTextPass.setGhostCostLabel(
      data && data.showCost && data.cost > 0
        ? {
            tileX: data.tileX,
            tileY: data.tileY,
            cost: data.cost,
            canAfford: data.canAfford,
            canPlace: data.canBuild || data.canUpgrade,
          }
        : null,
    );
    this.samGhostVisible =
      data !== null && SAM_RADIUS_GHOST_TYPES.has(data.ghostType);
    this.samRadiusPass.setVisible(
      this.samGhostVisible || this.samHighlightVisible,
    );
  }

  updateNukeTrajectory(data: NukeTrajectoryData | null): void {
    this.nukeTrajectoryPass.update(data);
  }

  updateNukeTelegraphs(data: NukeTelegraphData[]): void {
    this.nukeTelegraphPass.update(data);
  }

  updateSpawnOverlay(inSpawnPhase: boolean, centers: SpawnCenter[]): void {
    this.inSpawnPhase = inSpawnPhase;
    this.spawnOverlayPass.update(inSpawnPhase, centers);
  }

  updateSmallPlayerGlow(set: Uint8Array | null): void {
    this.smallPlayerGlowPass.update(set);
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  setHighlightOwner(ownerID: number): void {
    this.borderPass.setHighlightOwner(ownerID);
    this.territoryPass.setHighlightOwner(ownerID);
    this.namePass.setHighlightOwner(ownerID);
  }
  setMouseWorldPos(x: number, y: number): void {
    this.namePass.setMouseWorldPos(x, y);
  }
  setHighlightStructureTypes(unitTypes: string[] | null): void {
    this.structurePass.setHighlightTypes(unitTypes);
    this.structureLevelPass.setHighlightTypes(unitTypes);
    this.samHighlightVisible =
      unitTypes !== null &&
      unitTypes.some((t) => SAM_RADIUS_HIGHLIGHT_TYPES.has(t));
    this.samRadiusPass.setVisible(
      this.samGhostVisible || this.samHighlightVisible,
    );
  }

  setLocalPlayerID(id: number): void {
    if (id === this.localPlayerID) return;
    this.localPlayerID = id;
    this.samRadiusPass.setLocalPlayer(id);
    this.structurePass.setLocalPlayer(id);
    this.affiliationPalette.setLocalPlayer(id);
    this.unitPass.setLocalPlayer(id);
    this.railroadPass.setLocalPlayer(id);
  }

  setLocalRailColor(r: number, g: number, b: number): void {
    this.railroadPass.setLocalRailColor(r, g, b);
  }

  setSAMAllianceClusters(clusters: Map<number, number>): void {
    this.samRadiusPass.setAllianceClusters(clusters);
  }

  setAltView(active: boolean): void {
    this.altView = active;
    this.territoryPass.setAltView(active);
    this.borderStampPass.setAltView(active);
    this.unitPass.setAltView(active);
    this.structurePass.setAltView(active);
    this.trailPass.setAltView(active);
  }

  setShowPatterns(active: boolean): void {
    this.territoryPass.setShowPatterns(active);
  }

  setGridView(active: boolean): void {
    this.gridView = active;
    try {
      window.localStorage.setItem(GRID_VIEW_KEY, active ? "true" : "false");
    } catch {
      // Ignore if we are unable to use localstorage.
    }
  }

  getSettings(): RenderSettings {
    return this.settings;
  }

  // ---------------------------------------------------------------------------
  // Selection box (warship selection)
  // ---------------------------------------------------------------------------

  setSelectedUnits(unitIds: readonly number[]): void {
    // Copy in (callers may mutate their array).
    this.selectedUnitIds.length = 0;
    for (let i = 0; i < unitIds.length; i++) {
      this.selectedUnitIds.push(unitIds[i]);
    }
    if (this.selectedUnitIds.length === 0) {
      this.selectionBoxPass.hide();
    }
    // Position + color are rebuilt each frame in updateSelectionBox() from
    // lastUnits — dead units get dropped automatically.
  }

  private updateSelectionBox(): void {
    if (this.selectedUnitIds.length === 0) return;

    // Build the entries for this frame and prune dead unit IDs in place.
    const entries = this.selectionBoxEntries;
    entries.length = 0;
    let writeIdx = 0;
    for (let i = 0; i < this.selectedUnitIds.length; i++) {
      const id = this.selectedUnitIds[i];
      const unit = this.lastUnits.get(id);
      if (!unit || !unit.isActive) continue; // dead — drop
      this.selectedUnitIds[writeIdx++] = id;

      const centerX = unit.pos % this.mapW;
      const centerY = Math.floor(unit.pos / this.mapW);
      // Lighten the owner's territory color by ~20% (mix toward white).
      const off = unit.ownerID * 4;
      const r = Math.min(
        1,
        this.paletteData[off] + (1 - this.paletteData[off]) * 0.3,
      );
      const g = Math.min(
        1,
        this.paletteData[off + 1] + (1 - this.paletteData[off + 1]) * 0.3,
      );
      const b = Math.min(
        1,
        this.paletteData[off + 2] + (1 - this.paletteData[off + 2]) * 0.3,
      );
      entries.push({ centerX, centerY, r, g, b });
    }
    this.selectedUnitIds.length = writeIdx;

    this.selectionBoxPass.setSelections(entries);
  }

  // ---------------------------------------------------------------------------
  // Move indicator (warship move-target chevrons)
  // ---------------------------------------------------------------------------

  showMoveIndicator(tileX: number, tileY: number, ownerID: number): void {
    const off = ownerID * 4;
    const r = Math.min(
      1,
      this.paletteData[off] + (1 - this.paletteData[off]) * 0.3,
    );
    const g = Math.min(
      1,
      this.paletteData[off + 1] + (1 - this.paletteData[off + 1]) * 0.3,
    );
    const b = Math.min(
      1,
      this.paletteData[off + 2] + (1 - this.paletteData[off + 2]) * 0.3,
    );
    this.moveIndicatorPass.show(tileX, tileY, r, g, b);
  }

  // ---------------------------------------------------------------------------
  // Render — normalized draw order
  // ---------------------------------------------------------------------------

  draw(): void {
    this.uploadTextures();
    this.computeTextures();
    this.renderFrame();
  }

  private uploadTextures(): void {
    if (this.altView) this.affiliationPalette.flush();
    if (this.inSpawnPhase) {
      this.territoryPass.flushAllDripBuckets();
    } else {
      this.territoryPass.drainDripBucket();
    }
    // Full uploads need a full border recompute; scatter uploads already
    // pushed per-tile border patches via the wired `borderPatchConsumer`.
    if (this.territoryPass.flushTileTexture() === "full") {
      this.borderPass.markGlobalDirty();
      this.defenseCoveragePass.markDirty();
    }
    // Heat decay only runs while fallout is in play — (re)activate whenever a
    // fallout bit flipped in the tile state that just reached the GPU.
    if (this.territoryPass.consumeFalloutTouched()) {
      this.heatManager.activate();
    }
    this.trailPass.flushTexture();
    this.heatManager.updateHeat();
  }

  private computeTextures(): void {
    if (this.settings.passEnabled.borderCompute) this.borderPass.draw();
    // Re-stamp defense coverage if posts/territory changed (dirty-gated).
    // Leaves the default framebuffer bound; renderFrame resets the viewport.
    this.defenseCoveragePass.draw();
  }

  private renderFrame(): void {
    const cam = this.camera.getMatrix();
    const zoom = this.camera.zoom;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const compositingActive = this.isLightCompositingActive();

    if (compositingActive) {
      this.resizeSceneTargetIfNeeded(cw, ch);
      const sceneTex = toTarget(this.gl, this.sceneTarget, () =>
        this.drawBaseLayer(cam),
      );
      const lightTex = this.lightmapPass.draw(cam, cw, ch, this.frameTick);
      toScreen(this.gl, cw, ch, () =>
        this.nightCompositePass.draw(sceneTex, lightTex),
      );
    } else {
      toScreen(this.gl, cw, ch, () => this.drawBaseLayer(cam));
    }

    this.renderOverlays(cam, zoom);
  }

  private isLightCompositingActive(): boolean {
    return this.settings.lighting.enabled;
  }

  private resizeSceneTargetIfNeeded(cw: number, ch: number): void {
    if (this.sceneTarget.w === cw && this.sceneTarget.h === ch) return;
    this.sceneTarget.w = cw;
    this.sceneTarget.h = ch;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTarget.tex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      cw,
      ch,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
  }

  private drawBaseLayer(cam: Float32Array): void {
    const gl = this.gl;
    const pe = this.settings.passEnabled;
    gl.clearColor(60 / 255, 60 / 255, 60 / 255, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.BLEND);
    if (pe.terrain) this.terrainPass.draw(cam);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    if (pe.territory) this.territoryPass.draw(cam);
  }

  private renderOverlays(cam: Float32Array, zoom: number): void {
    const gl = this.gl;
    const pe = this.settings.passEnabled;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    this.spawnOverlayPass.draw(cam);
    if (pe.borderStamp) this.borderStampPass.draw(cam);
    if (pe.railroad) this.railroadPass.draw(cam, zoom);
    if (pe.unit) this.unitPass.drawGround(cam);
    if (pe.falloutBloom) this.bloomPass.draw(cam, this.frameTick);
    this.samRadiusPass.draw(cam);
    this.rangeCirclePass.draw(cam);
    this.nukeTrajectoryPass.draw(cam);
    this.crosshairPass.draw(cam);
    if (pe.structure) this.structurePass.draw(cam, zoom);
    if (pe.structure) this.structureLevelPass.draw(cam, zoom);
    // Small-player glow draws after structures so buildings can't hide it.
    this.smallPlayerGlowPass.draw(cam);
    if (pe.bar) this.barPass.draw(cam);
    this.updateSelectionBox();
    this.selectionBoxPass.draw(cam, this.frameTick);
    this.moveIndicatorPass.draw(cam, zoom);
    this.nukeTelegraphPass.draw(cam);
    if (pe.trail) this.trailPass.draw(cam);
    if (pe.unit) this.unitPass.drawMissiles(cam);

    if (pe.fx) {
      this.fxPass.tick();
      this.fxPass.draw(cam, zoom);
    }

    // Grid shows on either trigger; names hide only under alt-view (space
    // hold), not under the persistent M-key gridView toggle.
    if (this.gridView || this.altView) this.coordinateGridPass.draw(cam, zoom);
    if (pe.name && !this.altView)
      this.namePass.draw(cam, this.nightCompositePass.getAmbient());

    // World text (attack-troop labels, popups, ghost cost) draws on top of
    // player names so attack callouts aren't hidden behind a centered name.
    this.worldTextPass.tick(zoom);
    this.worldTextPass.draw(cam, zoom);

    gl.disable(gl.BLEND);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  dispose(): void {
    this.stopLoop();
    this.terrainPass.dispose();
    this.territoryPass.dispose();
    this.trailPass.dispose();
    this.borderStampPass.dispose();
    this.borderPass.dispose();
    this.defenseCoveragePass.dispose();
    this.bloomPass.dispose();
    this.pointLightPass.dispose();
    this.falloutLightPass.dispose();
    this.lightmapPass.dispose();
    this.nightCompositePass.dispose();
    this.heatManager.dispose();
    this.affiliationPalette.dispose();
    this.coordinateGridPass.dispose();
    this.spawnOverlayPass.dispose();
    this.smallPlayerGlowPass.dispose();
    this.railroadPass.dispose();
    this.rangeCirclePass.dispose();
    this.samRadiusPass.dispose();
    this.crosshairPass.dispose();
    this.structurePass.dispose();
    this.structureLevelPass.dispose();
    this.unitPass.dispose();
    this.namePass.dispose();
    this.fxPass.dispose();
    this.worldTextPass.dispose();
    this.selectionBoxPass.dispose();
    this.moveIndicatorPass.dispose();
    this.nukeTrajectoryPass.dispose();
    this.nukeTelegraphPass.dispose();
    this.barPass.dispose();
    disposeGPUResources(this.gl, this.res);
    this.gl.deleteTexture(this.paletteTex);
    this.gl.deleteTexture(this.patternMetaTex);
    this.gl.deleteTexture(this.patternDataTex);
    this.gl.deleteTexture(this.skinLayerTex);
    this.gl.deleteTexture(this.skinAnchorTex);
    this.skinAtlas.dispose();
    this.gl.deleteFramebuffer(this.sceneTarget.fbo);
    this.gl.deleteTexture(this.sceneTarget.tex);
    this.lastUnits = new Map();
    this.lastStructures = new Map();
    // Deleting GL resources isn't enough — the context itself counts against
    // the browser's WebGL context limit until it's GC'd, which is unreliable
    // on mobile. Explicitly drop it so repeated game starts don't overflow.
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
