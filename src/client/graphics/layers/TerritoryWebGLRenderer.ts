import { base64url } from "jose";
import { DefaultPattern } from "../../../core/CosmeticSchemas";
import { Theme } from "../../../core/configuration/Config";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { FrameProfiler } from "../FrameProfiler";

type DirtySpan = { minX: number; maxX: number };

export interface TerritoryWebGLCreateResult {
  renderer: TerritoryWebGLRenderer | null;
  reason?: string;
}

export interface HoverHighlightOptions {
  color?: { r: number; g: number; b: number };
  strength?: number;
  pulseStrength?: number;
  pulseSpeed?: number;
}

const PATTERN_STRIDE_BYTES = 1052;

// WebGL2 territory renderer that shades tiles from packed tile state
// (Uint16Array) using palette, relation, and pattern textures.
export class TerritoryWebGLRenderer {
  public readonly canvas: HTMLCanvasElement;

  private contestEnabled = false;

  private readonly gl: WebGL2RenderingContext | null;
  private readonly program: WebGLProgram | null;
  private readonly vao: WebGLVertexArrayObject | null;
  private readonly vertexBuffer: WebGLBuffer | null;
  private readonly jfaVao: WebGLVertexArrayObject | null;
  private readonly jfaVertexBuffer: WebGLBuffer | null;
  private readonly stateTexture: WebGLTexture | null;
  private readonly terrainTexture: WebGLTexture | null;
  private readonly paletteTexture: WebGLTexture | null;
  private readonly relationTexture: WebGLTexture | null;
  private readonly patternTexture: WebGLTexture | null;
  private readonly contestOwnersTexture: WebGLTexture | null;
  private readonly contestIdsTexture: WebGLTexture | null;
  private readonly contestTimesTexture: WebGLTexture | null;
  private readonly contestStrengthsTexture: WebGLTexture | null;
  private readonly prevOwnerTexture: WebGLTexture | null;
  private readonly olderOwnerTexture: WebGLTexture | null;
  private readonly stateFramebuffer: WebGLFramebuffer | null;
  private readonly prevStateFramebuffer: WebGLFramebuffer | null;
  private readonly olderStateFramebuffer: WebGLFramebuffer | null;
  private readonly jfaTextureA: WebGLTexture | null;
  private readonly jfaTextureB: WebGLTexture | null;
  private readonly jfaFramebufferA: WebGLFramebuffer | null;
  private readonly jfaFramebufferB: WebGLFramebuffer | null;
  private readonly jfaResultOlderTexture: WebGLTexture | null;
  private readonly jfaResultOldTexture: WebGLTexture | null;
  private readonly jfaResultNewTexture: WebGLTexture | null;
  private readonly jfaResultOlderFramebuffer: WebGLFramebuffer | null;
  private readonly jfaResultOldFramebuffer: WebGLFramebuffer | null;
  private readonly jfaResultNewFramebuffer: WebGLFramebuffer | null;
  private readonly jfaSeedProgram: WebGLProgram | null;
  private readonly jfaProgram: WebGLProgram | null;
  private readonly changeMaskProgram: WebGLProgram | null;
  private readonly changeMaskTextureOlder: WebGLTexture | null;
  private readonly changeMaskTextureOld: WebGLTexture | null;
  private readonly changeMaskTextureNew: WebGLTexture | null;
  private readonly changeMaskFramebufferOlder: WebGLFramebuffer | null;
  private readonly changeMaskFramebufferOld: WebGLFramebuffer | null;
  private readonly changeMaskFramebufferNew: WebGLFramebuffer | null;
  private readonly jfaSeedUniforms: {
    resolution: WebGLUniformLocation | null;
    owner: WebGLUniformLocation | null;
  };
  private readonly jfaUniforms: {
    resolution: WebGLUniformLocation | null;
    step: WebGLUniformLocation | null;
    seeds: WebGLUniformLocation | null;
  };
  private readonly changeMaskUniforms: {
    resolution: WebGLUniformLocation | null;
    oldTexture: WebGLUniformLocation | null;
    newTexture: WebGLUniformLocation | null;
  };
  private readonly uniforms: {
    mapResolution: WebGLUniformLocation | null;
    viewResolution: WebGLUniformLocation | null;
    viewScale: WebGLUniformLocation | null;
    viewOffset: WebGLUniformLocation | null;
    state: WebGLUniformLocation | null;
    terrain: WebGLUniformLocation | null;
    latestState: WebGLUniformLocation | null;
    palette: WebGLUniformLocation | null;
    relations: WebGLUniformLocation | null;
    patterns: WebGLUniformLocation | null;
    contestEnabled: WebGLUniformLocation | null;
    contestOwners: WebGLUniformLocation | null;
    contestIds: WebGLUniformLocation | null;
    contestTimes: WebGLUniformLocation | null;
    contestStrengths: WebGLUniformLocation | null;
    jfaAvailable: WebGLUniformLocation | null;
    contestNow: WebGLUniformLocation | null;
    contestDuration: WebGLUniformLocation | null;
    prevOwner: WebGLUniformLocation | null;
    jfaSeedsOld: WebGLUniformLocation | null;
    jfaSeedsNew: WebGLUniformLocation | null;
    smoothProgress: WebGLUniformLocation | null;
    changeMask: WebGLUniformLocation | null;
    smoothEnabled: WebGLUniformLocation | null;
    patternStride: WebGLUniformLocation | null;
    patternRows: WebGLUniformLocation | null;
    fallout: WebGLUniformLocation | null;
    altSelf: WebGLUniformLocation | null;
    altAlly: WebGLUniformLocation | null;
    altNeutral: WebGLUniformLocation | null;
    altEnemy: WebGLUniformLocation | null;
    alpha: WebGLUniformLocation | null;
    alternativeView: WebGLUniformLocation | null;
    hoveredPlayerId: WebGLUniformLocation | null;
    hoverHighlightStrength: WebGLUniformLocation | null;
    hoverHighlightColor: WebGLUniformLocation | null;
    hoverPulseStrength: WebGLUniformLocation | null;
    hoverPulseSpeed: WebGLUniformLocation | null;
    time: WebGLUniformLocation | null;
    viewerId: WebGLUniformLocation | null;
    darkMode: WebGLUniformLocation | null;
  };

  private readonly mapWidth: number;
  private readonly mapHeight: number;
  private viewWidth: number;
  private viewHeight: number;
  private viewScale = 1;
  private viewOffsetX = 0;
  private viewOffsetY = 0;

  private readonly state: Uint16Array;
  private contestOwnersState: Uint16Array;
  private contestIdsState: Uint16Array;
  private contestTimesState: Uint16Array;
  private contestStrengthsState: Uint16Array;
  private readonly dirtyRows: Map<number, DirtySpan> = new Map();
  private readonly contestDirtyRows: Map<number, DirtySpan> = new Map();
  private needsFullUpload = true;
  private needsContestFullUpload = true;
  private needsContestTimesUpload = true;
  private needsContestStrengthsUpload = true;
  private alternativeView = false;
  private paletteWidth = 0;
  // Defaults are overridden by setHoverHighlightOptions() from TerritoryLayer.
  private hoverHighlightStrength = 0.3;
  // Defaults are overridden by setHoverHighlightOptions() from TerritoryLayer.
  private hoverHighlightColor: [number, number, number] = [1, 1, 1];
  // Defaults are overridden by setHoverHighlightOptions() from TerritoryLayer.
  private hoverPulseStrength = 0.25;
  // Defaults are overridden by setHoverHighlightOptions() from TerritoryLayer.
  private hoverPulseSpeed = Math.PI * 2;
  private hoveredPlayerId = -1;
  private hoverStartTime = 0;
  private static readonly HOVER_DURATION_MS = 5000;
  private animationStartTime = Date.now();
  private contestNow = 0;
  private contestDurationTicks = 0;
  private smoothProgress = 1;
  private smoothEnabled = true;
  private jfaSupported = false;
  private jfaDisabledReason: string | null = null;
  private jfaDirty = false;
  private jfaHistoryInitialized = false;
  private changeMaskDirty = false;
  private changeMaskHistoryInitialized = false;
  private prevStateCopySupported = false;
  private jfaSteps: number[] = [];
  private interpolationPair: "prevCurrent" | "olderPrev" = "prevCurrent";
  private readonly userSettings = new UserSettings();
  private readonly patternBytesCache = new Map<string, Uint8Array>();

  private constructor(
    private readonly game: GameView,
    private readonly theme: Theme,
    state: Uint16Array,
  ) {
    this.canvas = document.createElement("canvas");
    this.mapWidth = game.width();
    this.mapHeight = game.height();
    this.viewWidth = this.mapWidth;
    this.viewHeight = this.mapHeight;
    this.canvas.width = this.viewWidth;
    this.canvas.height = this.viewHeight;

    this.state = state;
    this.contestOwnersState = new Uint16Array(state.length * 2);
    this.contestIdsState = new Uint16Array(state.length);
    this.contestTimesState = new Uint16Array(1);
    this.contestStrengthsState = new Uint16Array(1);

    this.gl = this.canvas.getContext("webgl2", {
      premultipliedAlpha: true,
      antialias: false,
      preserveDrawingBuffer: true,
    });

    if (!this.gl) {
      this.program = null;
      this.vao = null;
      this.vertexBuffer = null;
      this.jfaVao = null;
      this.jfaVertexBuffer = null;
      this.stateTexture = null;
      this.terrainTexture = null;
      this.paletteTexture = null;
      this.relationTexture = null;
      this.patternTexture = null;
      this.contestOwnersTexture = null;
      this.contestIdsTexture = null;
      this.contestTimesTexture = null;
      this.contestStrengthsTexture = null;
      this.prevOwnerTexture = null;
      this.olderOwnerTexture = null;
      this.stateFramebuffer = null;
      this.prevStateFramebuffer = null;
      this.olderStateFramebuffer = null;
      this.jfaTextureA = null;
      this.jfaTextureB = null;
      this.jfaFramebufferA = null;
      this.jfaFramebufferB = null;
      this.jfaResultOlderTexture = null;
      this.jfaResultOldTexture = null;
      this.jfaResultNewTexture = null;
      this.jfaResultOlderFramebuffer = null;
      this.jfaResultOldFramebuffer = null;
      this.jfaResultNewFramebuffer = null;
      this.jfaSeedProgram = null;
      this.jfaProgram = null;
      this.changeMaskProgram = null;
      this.changeMaskTextureOlder = null;
      this.changeMaskTextureOld = null;
      this.changeMaskTextureNew = null;
      this.changeMaskFramebufferOlder = null;
      this.changeMaskFramebufferOld = null;
      this.changeMaskFramebufferNew = null;
      this.jfaSeedUniforms = { resolution: null, owner: null };
      this.jfaUniforms = { resolution: null, step: null, seeds: null };
      this.changeMaskUniforms = {
        resolution: null,
        oldTexture: null,
        newTexture: null,
      };
      this.uniforms = {
        mapResolution: null,
        viewResolution: null,
        viewScale: null,
        viewOffset: null,
        state: null,
        terrain: null,
        latestState: null,
        palette: null,
        relations: null,
        patterns: null,
        contestEnabled: null,
        contestOwners: null,
        contestIds: null,
        contestTimes: null,
        contestStrengths: null,
        jfaAvailable: null,
        contestNow: null,
        contestDuration: null,
        prevOwner: null,
        jfaSeedsOld: null,
        jfaSeedsNew: null,
        smoothProgress: null,
        changeMask: null,
        smoothEnabled: null,
        patternStride: null,
        patternRows: null,
        fallout: null,
        altSelf: null,
        altAlly: null,
        altNeutral: null,
        altEnemy: null,
        alpha: null,
        alternativeView: null,
        hoveredPlayerId: null,
        hoverHighlightStrength: null,
        hoverHighlightColor: null,
        hoverPulseStrength: null,
        hoverPulseSpeed: null,
        time: null,
        viewerId: null,
        darkMode: null,
      };
      return;
    }

    const gl = this.gl;
    this.program = this.createProgram(gl);
    if (!this.program) {
      this.vao = null;
      this.vertexBuffer = null;
      this.jfaVao = null;
      this.jfaVertexBuffer = null;
      this.stateTexture = null;
      this.terrainTexture = null;
      this.paletteTexture = null;
      this.relationTexture = null;
      this.patternTexture = null;
      this.contestOwnersTexture = null;
      this.contestIdsTexture = null;
      this.contestTimesTexture = null;
      this.contestStrengthsTexture = null;
      this.prevOwnerTexture = null;
      this.olderOwnerTexture = null;
      this.stateFramebuffer = null;
      this.prevStateFramebuffer = null;
      this.olderStateFramebuffer = null;
      this.jfaTextureA = null;
      this.jfaTextureB = null;
      this.jfaFramebufferA = null;
      this.jfaFramebufferB = null;
      this.jfaResultOlderTexture = null;
      this.jfaResultOldTexture = null;
      this.jfaResultNewTexture = null;
      this.jfaResultOlderFramebuffer = null;
      this.jfaResultOldFramebuffer = null;
      this.jfaResultNewFramebuffer = null;
      this.jfaSeedProgram = null;
      this.jfaProgram = null;
      this.changeMaskProgram = null;
      this.changeMaskTextureOlder = null;
      this.changeMaskTextureOld = null;
      this.changeMaskTextureNew = null;
      this.changeMaskFramebufferOlder = null;
      this.changeMaskFramebufferOld = null;
      this.changeMaskFramebufferNew = null;
      this.jfaSeedUniforms = { resolution: null, owner: null };
      this.jfaUniforms = { resolution: null, step: null, seeds: null };
      this.changeMaskUniforms = {
        resolution: null,
        oldTexture: null,
        newTexture: null,
      };
      this.uniforms = {
        mapResolution: null,
        viewResolution: null,
        viewScale: null,
        viewOffset: null,
        state: null,
        terrain: null,
        latestState: null,
        palette: null,
        relations: null,
        patterns: null,
        contestEnabled: null,
        contestOwners: null,
        contestIds: null,
        contestTimes: null,
        contestStrengths: null,
        jfaAvailable: null,
        contestNow: null,
        contestDuration: null,
        prevOwner: null,
        jfaSeedsOld: null,
        jfaSeedsNew: null,
        smoothProgress: null,
        changeMask: null,
        smoothEnabled: null,
        patternStride: null,
        patternRows: null,
        fallout: null,
        altSelf: null,
        altAlly: null,
        altNeutral: null,
        altEnemy: null,
        alpha: null,
        alternativeView: null,
        hoveredPlayerId: null,
        hoverHighlightStrength: null,
        hoverHighlightColor: null,
        hoverPulseStrength: null,
        hoverPulseSpeed: null,
        time: null,
        viewerId: null,
        darkMode: null,
      };
      return;
    }

    this.jfaSupported = !!gl.getExtension("EXT_color_buffer_float");
    if (!this.jfaSupported) {
      this.jfaDisabledReason = "EXT_color_buffer_float unavailable";
    }
    this.jfaSeedProgram = this.jfaSupported
      ? this.createJfaSeedProgram(gl)
      : null;
    this.jfaProgram = this.jfaSupported ? this.createJfaProgram(gl) : null;
    this.changeMaskProgram = this.jfaSupported
      ? this.createChangeMaskProgram(gl)
      : null;
    if (!this.jfaSeedProgram || !this.jfaProgram) {
      this.jfaSupported = false;
      this.jfaDisabledReason ??= "JFA shaders unavailable";
    }
    this.jfaSeedUniforms = this.jfaSeedProgram
      ? {
          resolution: gl.getUniformLocation(
            this.jfaSeedProgram,
            "u_resolution",
          ),
          owner: gl.getUniformLocation(this.jfaSeedProgram, "u_ownerTexture"),
        }
      : { resolution: null, owner: null };
    this.jfaUniforms = this.jfaProgram
      ? {
          resolution: gl.getUniformLocation(this.jfaProgram, "u_resolution"),
          step: gl.getUniformLocation(this.jfaProgram, "u_step"),
          seeds: gl.getUniformLocation(this.jfaProgram, "u_seeds"),
        }
      : { resolution: null, step: null, seeds: null };
    this.changeMaskUniforms = this.changeMaskProgram
      ? {
          resolution: gl.getUniformLocation(
            this.changeMaskProgram,
            "u_resolution",
          ),
          oldTexture: gl.getUniformLocation(
            this.changeMaskProgram,
            "u_oldTexture",
          ),
          newTexture: gl.getUniformLocation(
            this.changeMaskProgram,
            "u_newTexture",
          ),
        }
      : { resolution: null, oldTexture: null, newTexture: null };

    this.uniforms = {
      mapResolution: gl.getUniformLocation(this.program, "u_mapResolution"),
      viewResolution: gl.getUniformLocation(this.program, "u_viewResolution"),
      viewScale: gl.getUniformLocation(this.program, "u_viewScale"),
      viewOffset: gl.getUniformLocation(this.program, "u_viewOffset"),
      state: gl.getUniformLocation(this.program, "u_state"),
      terrain: gl.getUniformLocation(this.program, "u_terrain"),
      latestState: gl.getUniformLocation(this.program, "u_latestState"),
      palette: gl.getUniformLocation(this.program, "u_palette"),
      relations: gl.getUniformLocation(this.program, "u_relations"),
      patterns: gl.getUniformLocation(this.program, "u_patterns"),
      contestEnabled: gl.getUniformLocation(this.program, "u_contestEnabled"),
      contestOwners: gl.getUniformLocation(this.program, "u_contestOwners"),
      contestIds: gl.getUniformLocation(this.program, "u_contestIds"),
      contestTimes: gl.getUniformLocation(this.program, "u_contestTimes"),
      contestStrengths: gl.getUniformLocation(
        this.program,
        "u_contestStrengths",
      ),
      jfaAvailable: gl.getUniformLocation(this.program, "u_jfaAvailable"),
      contestNow: gl.getUniformLocation(this.program, "u_contestNow"),
      contestDuration: gl.getUniformLocation(
        this.program,
        "u_contestDurationTicks",
      ),
      prevOwner: gl.getUniformLocation(this.program, "u_prevOwner"),
      jfaSeedsOld: gl.getUniformLocation(this.program, "u_jfaSeedsOld"),
      jfaSeedsNew: gl.getUniformLocation(this.program, "u_jfaSeedsNew"),
      smoothProgress: gl.getUniformLocation(this.program, "u_smoothProgress"),
      changeMask: gl.getUniformLocation(this.program, "u_changeMask"),
      smoothEnabled: gl.getUniformLocation(this.program, "u_smoothEnabled"),
      patternStride: gl.getUniformLocation(this.program, "u_patternStride"),
      patternRows: gl.getUniformLocation(this.program, "u_patternRows"),
      fallout: gl.getUniformLocation(this.program, "u_fallout"),
      altSelf: gl.getUniformLocation(this.program, "u_altSelf"),
      altAlly: gl.getUniformLocation(this.program, "u_altAlly"),
      altNeutral: gl.getUniformLocation(this.program, "u_altNeutral"),
      altEnemy: gl.getUniformLocation(this.program, "u_altEnemy"),
      alpha: gl.getUniformLocation(this.program, "u_alpha"),
      alternativeView: gl.getUniformLocation(this.program, "u_alternativeView"),
      hoveredPlayerId: gl.getUniformLocation(this.program, "u_hoveredPlayerId"),
      hoverHighlightStrength: gl.getUniformLocation(
        this.program,
        "u_hoverHighlightStrength",
      ),
      hoverHighlightColor: gl.getUniformLocation(
        this.program,
        "u_hoverHighlightColor",
      ),
      hoverPulseStrength: gl.getUniformLocation(
        this.program,
        "u_hoverPulseStrength",
      ),
      hoverPulseSpeed: gl.getUniformLocation(this.program, "u_hoverPulseSpeed"),
      time: gl.getUniformLocation(this.program, "u_time"),
      viewerId: gl.getUniformLocation(this.program, "u_viewerId"),
      darkMode: gl.getUniformLocation(this.program, "u_darkMode"),
    };

    // Vertex data: two triangles covering the full view (pixel-perfect).
    const vertices = new Float32Array([
      0,
      0,
      this.viewWidth,
      0,
      0,
      this.viewHeight,
      0,
      this.viewHeight,
      this.viewWidth,
      0,
      this.viewWidth,
      this.viewHeight,
    ]);

    this.vao = gl.createVertexArray();
    this.vertexBuffer = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(this.program, "a_position");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 2 * 4, 0);
    gl.bindVertexArray(null);

    const mapVertices = new Float32Array([
      0,
      0,
      this.mapWidth,
      0,
      0,
      this.mapHeight,
      0,
      this.mapHeight,
      this.mapWidth,
      0,
      this.mapWidth,
      this.mapHeight,
    ]);
    this.jfaVao = gl.createVertexArray();
    this.jfaVertexBuffer = gl.createBuffer();
    gl.bindVertexArray(this.jfaVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.jfaVertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mapVertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 2 * 4, 0);
    gl.bindVertexArray(null);

    this.stateTexture = gl.createTexture();
    this.terrainTexture = gl.createTexture();
    this.paletteTexture = gl.createTexture();
    this.relationTexture = gl.createTexture();
    this.patternTexture = gl.createTexture();
    this.contestOwnersTexture = gl.createTexture();
    this.contestIdsTexture = gl.createTexture();
    this.contestTimesTexture = gl.createTexture();
    this.contestStrengthsTexture = gl.createTexture();
    this.prevOwnerTexture = gl.createTexture();
    this.olderOwnerTexture = gl.createTexture();
    this.stateFramebuffer = gl.createFramebuffer();
    this.prevStateFramebuffer = gl.createFramebuffer();
    this.olderStateFramebuffer = gl.createFramebuffer();
    this.jfaTextureA = this.jfaSupported ? gl.createTexture() : null;
    this.jfaTextureB = this.jfaSupported ? gl.createTexture() : null;
    this.jfaFramebufferA = this.jfaSupported ? gl.createFramebuffer() : null;
    this.jfaFramebufferB = this.jfaSupported ? gl.createFramebuffer() : null;
    this.jfaResultOlderTexture = this.jfaSupported ? gl.createTexture() : null;
    this.jfaResultOldTexture = this.jfaSupported ? gl.createTexture() : null;
    this.jfaResultNewTexture = this.jfaSupported ? gl.createTexture() : null;
    this.jfaResultOlderFramebuffer = this.jfaSupported
      ? gl.createFramebuffer()
      : null;
    this.jfaResultOldFramebuffer = this.jfaSupported
      ? gl.createFramebuffer()
      : null;
    this.jfaResultNewFramebuffer = this.jfaSupported
      ? gl.createFramebuffer()
      : null;
    this.changeMaskTextureOlder = this.jfaSupported ? gl.createTexture() : null;
    this.changeMaskTextureOld = this.jfaSupported ? gl.createTexture() : null;
    this.changeMaskTextureNew = this.jfaSupported ? gl.createTexture() : null;
    this.changeMaskFramebufferOlder = this.jfaSupported
      ? gl.createFramebuffer()
      : null;
    this.changeMaskFramebufferOld = this.jfaSupported
      ? gl.createFramebuffer()
      : null;
    this.changeMaskFramebufferNew = this.jfaSupported
      ? gl.createFramebuffer()
      : null;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.stateTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R16UI,
      this.mapWidth,
      this.mapHeight,
      0,
      gl.RED_INTEGER,
      gl.UNSIGNED_SHORT,
      this.state,
    );

    // Terrain texture (immutable, only uploaded once)
    gl.activeTexture(gl.TEXTURE14);
    gl.bindTexture(gl.TEXTURE_2D, this.terrainTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8UI,
      this.mapWidth,
      this.mapHeight,
      0,
      gl.RED_INTEGER,
      gl.UNSIGNED_BYTE,
      game.terrainView(),
    );

    this.uploadPalette();

    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.contestOwnersTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RG16UI,
      this.mapWidth,
      this.mapHeight,
      0,
      gl.RG_INTEGER,
      gl.UNSIGNED_SHORT,
      this.contestOwnersState,
    );

    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.contestIdsTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R16UI,
      this.mapWidth,
      this.mapHeight,
      0,
      gl.RED_INTEGER,
      gl.UNSIGNED_SHORT,
      this.contestIdsState,
    );

    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, this.contestTimesTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R16UI,
      this.contestTimesState.length,
      1,
      0,
      gl.RED_INTEGER,
      gl.UNSIGNED_SHORT,
      this.contestTimesState,
    );

    gl.activeTexture(gl.TEXTURE11);
    gl.bindTexture(gl.TEXTURE_2D, this.contestStrengthsTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R16UI,
      this.contestStrengthsState.length,
      1,
      0,
      gl.RED_INTEGER,
      gl.UNSIGNED_SHORT,
      this.contestStrengthsState,
    );

    gl.activeTexture(gl.TEXTURE7);
    gl.bindTexture(gl.TEXTURE_2D, this.prevOwnerTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R16UI,
      this.mapWidth,
      this.mapHeight,
      0,
      gl.RED_INTEGER,
      gl.UNSIGNED_SHORT,
      this.state,
    );

    gl.activeTexture(gl.TEXTURE13);
    gl.bindTexture(gl.TEXTURE_2D, this.olderOwnerTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R16UI,
      this.mapWidth,
      this.mapHeight,
      0,
      gl.RED_INTEGER,
      gl.UNSIGNED_SHORT,
      this.state,
    );

    if (
      this.stateFramebuffer &&
      this.prevStateFramebuffer &&
      this.olderStateFramebuffer &&
      this.stateTexture &&
      this.prevOwnerTexture &&
      this.olderOwnerTexture
    ) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.stateFramebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        this.stateTexture,
        0,
      );
      const stateStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.prevStateFramebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        this.prevOwnerTexture,
        0,
      );
      const prevStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.olderStateFramebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        this.olderOwnerTexture,
        0,
      );
      const olderStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      this.prevStateCopySupported =
        stateStatus === gl.FRAMEBUFFER_COMPLETE &&
        prevStatus === gl.FRAMEBUFFER_COMPLETE &&
        olderStatus === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    if (
      this.jfaSupported &&
      this.jfaTextureA &&
      this.jfaTextureB &&
      this.jfaFramebufferA &&
      this.jfaFramebufferB &&
      this.jfaResultOlderTexture &&
      this.jfaResultOldTexture &&
      this.jfaResultNewTexture &&
      this.jfaResultOlderFramebuffer &&
      this.jfaResultOldFramebuffer &&
      this.jfaResultNewFramebuffer
    ) {
      gl.activeTexture(gl.TEXTURE9);
      gl.bindTexture(gl.TEXTURE_2D, this.jfaTextureA);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RG16F,
        this.mapWidth,
        this.mapHeight,
        0,
        gl.RG,
        gl.HALF_FLOAT,
        null,
      );

      gl.activeTexture(gl.TEXTURE10);
      gl.bindTexture(gl.TEXTURE_2D, this.jfaTextureB);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RG16F,
        this.mapWidth,
        this.mapHeight,
        0,
        gl.RG,
        gl.HALF_FLOAT,
        null,
      );

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.jfaFramebufferA);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        this.jfaTextureA,
        0,
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.jfaFramebufferB);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        this.jfaTextureB,
        0,
      );

      gl.activeTexture(gl.TEXTURE12);
      gl.bindTexture(gl.TEXTURE_2D, this.jfaResultOlderTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RG16F,
        this.mapWidth,
        this.mapHeight,
        0,
        gl.RG,
        gl.HALF_FLOAT,
        null,
      );

      gl.activeTexture(gl.TEXTURE10);
      gl.bindTexture(gl.TEXTURE_2D, this.jfaResultOldTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RG16F,
        this.mapWidth,
        this.mapHeight,
        0,
        gl.RG,
        gl.HALF_FLOAT,
        null,
      );

      gl.activeTexture(gl.TEXTURE11);
      gl.bindTexture(gl.TEXTURE_2D, this.jfaResultNewTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RG16F,
        this.mapWidth,
        this.mapHeight,
        0,
        gl.RG,
        gl.HALF_FLOAT,
        null,
      );

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.jfaResultOlderFramebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        this.jfaResultOlderTexture,
        0,
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.jfaResultOldFramebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        this.jfaResultOldTexture,
        0,
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.jfaResultNewFramebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        this.jfaResultNewTexture,
        0,
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      this.jfaSteps = this.buildJfaSteps(this.mapWidth, this.mapHeight);
      this.jfaDirty = true;
    }

    if (
      this.jfaSupported &&
      this.changeMaskTextureOlder &&
      this.changeMaskTextureOld &&
      this.changeMaskTextureNew &&
      this.changeMaskFramebufferOlder &&
      this.changeMaskFramebufferOld &&
      this.changeMaskFramebufferNew
    ) {
      const initMaskTex = (tex: WebGLTexture) => {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.R8UI,
          this.mapWidth,
          this.mapHeight,
          0,
          gl.RED_INTEGER,
          gl.UNSIGNED_BYTE,
          null,
        );
      };

      gl.activeTexture(gl.TEXTURE13);
      initMaskTex(this.changeMaskTextureOlder);
      initMaskTex(this.changeMaskTextureOld);
      initMaskTex(this.changeMaskTextureNew);

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.changeMaskFramebufferOlder);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        this.changeMaskTextureOlder,
        0,
      );
      gl.clearBufferuiv(gl.COLOR, 0, new Uint32Array([0, 0, 0, 0]));
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.changeMaskFramebufferOld);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        this.changeMaskTextureOld,
        0,
      );
      gl.clearBufferuiv(gl.COLOR, 0, new Uint32Array([0, 0, 0, 0]));
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.changeMaskFramebufferNew);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        this.changeMaskTextureNew,
        0,
      );
      gl.clearBufferuiv(gl.COLOR, 0, new Uint32Array([0, 0, 0, 0]));
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      this.changeMaskDirty = true;
    }

    gl.useProgram(this.program);
    gl.uniform1i(this.uniforms.state, 0);
    if (this.uniforms.terrain) {
      gl.uniform1i(this.uniforms.terrain, 14);
    }
    if (this.uniforms.latestState) {
      gl.uniform1i(this.uniforms.latestState, 12);
    }
    gl.uniform1i(this.uniforms.palette, 1);
    gl.uniform1i(this.uniforms.relations, 2);
    gl.uniform1i(this.uniforms.patterns, 3);
    gl.uniform1i(this.uniforms.contestOwners, 4);
    gl.uniform1i(this.uniforms.contestIds, 5);
    gl.uniform1i(this.uniforms.contestTimes, 6);
    gl.uniform1i(this.uniforms.contestStrengths, 11);
    gl.uniform1i(this.uniforms.prevOwner, 7);
    gl.uniform1i(this.uniforms.jfaSeedsOld, 8);
    gl.uniform1i(this.uniforms.jfaSeedsNew, 9);
    if (this.uniforms.changeMask) {
      gl.uniform1i(this.uniforms.changeMask, 13);
    }

    if (this.uniforms.mapResolution) {
      gl.uniform2f(this.uniforms.mapResolution, this.mapWidth, this.mapHeight);
    }
    if (this.uniforms.viewResolution) {
      gl.uniform2f(
        this.uniforms.viewResolution,
        this.viewWidth,
        this.viewHeight,
      );
    }
    if (this.uniforms.viewScale) {
      gl.uniform1f(this.uniforms.viewScale, this.viewScale);
    }
    if (this.uniforms.viewOffset) {
      gl.uniform2f(
        this.uniforms.viewOffset,
        this.viewOffsetX,
        this.viewOffsetY,
      );
    }
    if (this.uniforms.alpha) {
      gl.uniform1f(this.uniforms.alpha, 150 / 255);
    }
    if (this.uniforms.fallout) {
      const f = this.theme.falloutColor().rgba;
      gl.uniform4f(
        this.uniforms.fallout,
        f.r / 255,
        f.g / 255,
        f.b / 255,
        f.a ?? 1,
      );
    }
    if (this.uniforms.altSelf) {
      const c = this.theme.selfColor().rgba;
      gl.uniform4f(
        this.uniforms.altSelf,
        c.r / 255,
        c.g / 255,
        c.b / 255,
        c.a ?? 1,
      );
    }
    if (this.uniforms.altAlly) {
      const c = this.theme.allyColor().rgba;
      gl.uniform4f(
        this.uniforms.altAlly,
        c.r / 255,
        c.g / 255,
        c.b / 255,
        c.a ?? 1,
      );
    }
    if (this.uniforms.altNeutral) {
      const c = this.theme.neutralColor().rgba;
      gl.uniform4f(
        this.uniforms.altNeutral,
        c.r / 255,
        c.g / 255,
        c.b / 255,
        c.a ?? 1,
      );
    }
    if (this.uniforms.altEnemy) {
      const c = this.theme.enemyColor().rgba;
      gl.uniform4f(
        this.uniforms.altEnemy,
        c.r / 255,
        c.g / 255,
        c.b / 255,
        c.a ?? 1,
      );
    }
    if (this.uniforms.viewerId) {
      const viewerId = this.game.myPlayer()?.smallID() ?? 0;
      gl.uniform1i(this.uniforms.viewerId, viewerId);
    }
    if (this.uniforms.viewResolution) {
      gl.uniform2f(
        this.uniforms.viewResolution,
        this.viewWidth,
        this.viewHeight,
      );
    }
    if (this.uniforms.viewScale) {
      gl.uniform1f(this.uniforms.viewScale, this.viewScale);
    }
    if (this.uniforms.viewOffset) {
      gl.uniform2f(
        this.uniforms.viewOffset,
        this.viewOffsetX,
        this.viewOffsetY,
      );
    }
    if (this.uniforms.alternativeView) {
      gl.uniform1i(this.uniforms.alternativeView, 0);
    }
    if (this.uniforms.hoveredPlayerId) {
      gl.uniform1f(this.uniforms.hoveredPlayerId, -1);
    }
    if (this.uniforms.hoverHighlightStrength) {
      gl.uniform1f(
        this.uniforms.hoverHighlightStrength,
        this.hoverHighlightStrength,
      );
    }
    if (this.uniforms.hoverHighlightColor) {
      const [r, g, b] = this.hoverHighlightColor;
      gl.uniform3f(this.uniforms.hoverHighlightColor, r, g, b);
    }
    if (this.uniforms.hoverPulseStrength) {
      gl.uniform1f(this.uniforms.hoverPulseStrength, this.hoverPulseStrength);
    }
    if (this.uniforms.hoverPulseSpeed) {
      gl.uniform1f(this.uniforms.hoverPulseSpeed, this.hoverPulseSpeed);
    }
    if (this.uniforms.jfaAvailable) {
      gl.uniform1i(this.uniforms.jfaAvailable, this.jfaSupported ? 1 : 0);
    }
    if (this.uniforms.contestNow) {
      gl.uniform1i(this.uniforms.contestNow, this.contestNow);
    }
    if (this.uniforms.contestDuration) {
      gl.uniform1f(this.uniforms.contestDuration, this.contestDurationTicks);
    }
    if (this.uniforms.smoothProgress) {
      gl.uniform1f(this.uniforms.smoothProgress, this.smoothProgress);
    }
    if (this.uniforms.smoothEnabled) {
      gl.uniform1i(this.uniforms.smoothEnabled, this.smoothEnabled ? 1 : 0);
    }

    if (
      this.jfaSupported &&
      this.jfaResultOldTexture &&
      this.jfaResultNewTexture
    ) {
      gl.activeTexture(gl.TEXTURE8);
      gl.bindTexture(gl.TEXTURE_2D, this.jfaResultOldTexture);
      gl.activeTexture(gl.TEXTURE9);
      gl.bindTexture(gl.TEXTURE_2D, this.jfaResultNewTexture);
    }

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.viewport(0, 0, this.viewWidth, this.viewHeight);
  }

  static create(game: GameView, theme: Theme): TerritoryWebGLCreateResult {
    const state = game.tileStateView();
    const expected = game.width() * game.height();
    if (state.length !== expected) {
      return {
        renderer: null,
        reason: "Tile state buffer size mismatch; WebGL renderer disabled.",
      };
    }

    const renderer = new TerritoryWebGLRenderer(game, theme, state);
    if (!renderer.isValid()) {
      return {
        renderer: null,
        reason: "WebGL2 not available; WebGL renderer disabled.",
      };
    }
    return { renderer };
  }

  isValid(): boolean {
    return !!this.gl && !!this.program && !!this.vao;
  }

  setAlternativeView(enabled: boolean) {
    this.alternativeView = enabled;
  }

  setViewSize(width: number, height: number) {
    const nextWidth = Math.max(1, Math.floor(width));
    const nextHeight = Math.max(1, Math.floor(height));
    if (nextWidth === this.viewWidth && nextHeight === this.viewHeight) {
      return;
    }
    this.viewWidth = nextWidth;
    this.viewHeight = nextHeight;
    this.canvas.width = nextWidth;
    this.canvas.height = nextHeight;
    if (!this.gl || !this.vertexBuffer) {
      return;
    }
    const gl = this.gl;
    const vertices = new Float32Array([
      0,
      0,
      this.viewWidth,
      0,
      0,
      this.viewHeight,
      0,
      this.viewHeight,
      this.viewWidth,
      0,
      this.viewWidth,
      this.viewHeight,
    ]);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    if (this.program) {
      gl.useProgram(this.program);
      if (this.uniforms.viewResolution) {
        gl.uniform2f(
          this.uniforms.viewResolution,
          this.viewWidth,
          this.viewHeight,
        );
      }
    }
  }

  setViewTransform(scale: number, offsetX: number, offsetY: number) {
    this.viewScale = scale;
    this.viewOffsetX = offsetX;
    this.viewOffsetY = offsetY;
  }

  setHoveredPlayerId(playerSmallId: number | null) {
    const encoded = playerSmallId ?? -1;
    if (encoded !== this.hoveredPlayerId) {
      this.hoveredPlayerId = encoded;
      this.hoverStartTime = encoded >= 0 ? Date.now() : 0;
    }
  }

  setHoverHighlightOptions(options: HoverHighlightOptions) {
    if (options.strength !== undefined) {
      this.hoverHighlightStrength = Math.max(0, Math.min(1, options.strength));
    }
    if (options.color) {
      this.hoverHighlightColor = [
        options.color.r / 255,
        options.color.g / 255,
        options.color.b / 255,
      ];
    }
    if (options.pulseStrength !== undefined) {
      this.hoverPulseStrength = Math.max(0, Math.min(1, options.pulseStrength));
    }
    if (options.pulseSpeed !== undefined) {
      this.hoverPulseSpeed = Math.max(0, options.pulseSpeed);
    }
  }

  setContestEnabled(enabled: boolean) {
    if (this.contestEnabled === enabled) {
      return;
    }
    this.contestEnabled = enabled;
    if (this.contestEnabled) {
      this.needsContestFullUpload = true;
      this.needsContestTimesUpload = true;
      this.needsContestStrengthsUpload = true;
    } else {
      this.contestDirtyRows.clear();
    }
  }

  markTile(tile: TileRef) {
    if (this.needsFullUpload) {
      return;
    }
    const x = tile % this.mapWidth;
    const y = Math.floor(tile / this.mapWidth);
    const span = this.dirtyRows.get(y);
    if (span === undefined) {
      this.dirtyRows.set(y, { minX: x, maxX: x });
    } else {
      span.minX = Math.min(span.minX, x);
      span.maxX = Math.max(span.maxX, x);
    }
  }

  setContestTile(
    tile: TileRef,
    defenderOwner: number,
    attackerOwner: number,
    componentId: number,
    attackerEver: boolean,
  ) {
    if (!this.contestEnabled) {
      return;
    }
    const offset = tile * 2;
    const defenderValue = defenderOwner & 0xffff;
    const attackerValue = attackerOwner & 0xffff;
    const idValue = (componentId & 0x7fff) | (attackerEver ? 0x8000 : 0);
    if (
      this.contestOwnersState[offset] === defenderValue &&
      this.contestOwnersState[offset + 1] === attackerValue &&
      this.contestIdsState[tile] === idValue
    ) {
      return;
    }
    this.contestOwnersState[offset] = defenderValue;
    this.contestOwnersState[offset + 1] = attackerValue;
    this.contestIdsState[tile] = idValue;
    if (this.needsContestFullUpload) {
      return;
    }
    const x = tile % this.mapWidth;
    const y = Math.floor(tile / this.mapWidth);
    const span = this.contestDirtyRows.get(y);
    if (span === undefined) {
      this.contestDirtyRows.set(y, { minX: x, maxX: x });
    } else {
      span.minX = Math.min(span.minX, x);
      span.maxX = Math.max(span.maxX, x);
    }
  }

  clearContestTile(tile: TileRef) {
    this.setContestTile(tile, 0, 0, 0, false);
  }

  setContestTime(componentId: number, nowPacked: number) {
    if (!this.contestEnabled) {
      return;
    }
    if (componentId <= 0) {
      return;
    }
    this.ensureContestTimeCapacity(componentId);
    const packed = nowPacked & 0xffff;
    if (this.contestTimesState[componentId] === packed) {
      return;
    }
    this.contestTimesState[componentId] = packed;
    this.needsContestTimesUpload = true;
  }

  ensureContestTimeCapacity(componentId: number) {
    if (componentId < this.contestTimesState.length) {
      return;
    }
    let nextLength = Math.max(1, this.contestTimesState.length);
    while (nextLength <= componentId) {
      nextLength *= 2;
    }
    const nextState = new Uint16Array(nextLength);
    nextState.set(this.contestTimesState);
    this.contestTimesState = nextState;
    this.needsContestTimesUpload = true;
  }

  setContestStrength(componentId: number, strength: number) {
    if (!this.contestEnabled) {
      return;
    }
    if (componentId <= 0) {
      return;
    }
    this.ensureContestStrengthCapacity(componentId);
    const clamped = Math.max(0, Math.min(1, strength));
    const packed = Math.round(clamped * 65535) & 0xffff;
    if (this.contestStrengthsState[componentId] === packed) {
      return;
    }
    this.contestStrengthsState[componentId] = packed;
    this.needsContestStrengthsUpload = true;
  }

  ensureContestStrengthCapacity(componentId: number) {
    if (componentId < this.contestStrengthsState.length) {
      return;
    }
    let nextLength = Math.max(1, this.contestStrengthsState.length);
    while (nextLength <= componentId) {
      nextLength *= 2;
    }
    const nextState = new Uint16Array(nextLength);
    nextState.set(this.contestStrengthsState);
    this.contestStrengthsState = nextState;
    this.needsContestStrengthsUpload = true;
  }

  setContestNow(nowPacked: number, durationTicks: number) {
    if (!this.contestEnabled) {
      return;
    }
    this.contestNow = nowPacked | 0;
    this.contestDurationTicks = Math.max(0, durationTicks);
  }

  snapshotStateForSmoothing() {
    if (
      !this.gl ||
      !this.prevStateCopySupported ||
      !this.stateFramebuffer ||
      !this.prevStateFramebuffer ||
      !this.olderStateFramebuffer
    ) {
      return;
    }
    const gl = this.gl;

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.prevStateFramebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.olderStateFramebuffer);
    gl.blitFramebuffer(
      0,
      0,
      this.mapWidth,
      this.mapHeight,
      0,
      0,
      this.mapWidth,
      this.mapHeight,
      gl.COLOR_BUFFER_BIT,
      gl.NEAREST,
    );
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.stateFramebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.prevStateFramebuffer);
    gl.blitFramebuffer(
      0,
      0,
      this.mapWidth,
      this.mapHeight,
      0,
      0,
      this.mapWidth,
      this.mapHeight,
      gl.COLOR_BUFFER_BIT,
      gl.NEAREST,
    );
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);

    if (
      this.jfaSupported &&
      this.jfaResultOlderFramebuffer &&
      this.jfaResultOldFramebuffer &&
      this.jfaResultNewFramebuffer
    ) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.jfaResultOldFramebuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.jfaResultOlderFramebuffer);
      gl.blitFramebuffer(
        0,
        0,
        this.mapWidth,
        this.mapHeight,
        0,
        0,
        this.mapWidth,
        this.mapHeight,
        gl.COLOR_BUFFER_BIT,
        gl.NEAREST,
      );
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.jfaResultNewFramebuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.jfaResultOldFramebuffer);
      gl.blitFramebuffer(
        0,
        0,
        this.mapWidth,
        this.mapHeight,
        0,
        0,
        this.mapWidth,
        this.mapHeight,
        gl.COLOR_BUFFER_BIT,
        gl.NEAREST,
      );
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    }

    if (
      this.jfaSupported &&
      this.changeMaskFramebufferOlder &&
      this.changeMaskFramebufferOld &&
      this.changeMaskFramebufferNew
    ) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.changeMaskFramebufferOld);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.changeMaskFramebufferOlder);
      gl.blitFramebuffer(
        0,
        0,
        this.mapWidth,
        this.mapHeight,
        0,
        0,
        this.mapWidth,
        this.mapHeight,
        gl.COLOR_BUFFER_BIT,
        gl.NEAREST,
      );
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.changeMaskFramebufferNew);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.changeMaskFramebufferOld);
      gl.blitFramebuffer(
        0,
        0,
        this.mapWidth,
        this.mapHeight,
        0,
        0,
        this.mapWidth,
        this.mapHeight,
        gl.COLOR_BUFFER_BIT,
        gl.NEAREST,
      );
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    }
    this.jfaDirty = true;
    this.changeMaskDirty = true;
  }

  setSmoothProgress(progress: number) {
    this.smoothProgress = Math.max(0, Math.min(1, progress));
  }

  setSmoothEnabled(enabled: boolean) {
    this.smoothEnabled =
      enabled &&
      this.jfaSupported &&
      this.prevStateCopySupported &&
      !!this.changeMaskProgram &&
      !!this.changeMaskTextureOld &&
      !!this.changeMaskTextureNew &&
      !!this.jfaResultOldTexture &&
      !!this.jfaResultNewTexture;
  }

  setInterpolationPair(pair: "prevCurrent" | "olderPrev") {
    this.interpolationPair = pair;
  }

  markAllDirty() {
    this.needsFullUpload = true;
    this.dirtyRows.clear();
    this.needsContestFullUpload = true;
    this.needsContestTimesUpload = true;
    this.needsContestStrengthsUpload = true;
    this.contestDirtyRows.clear();
    this.jfaDirty = true;
    this.changeMaskDirty = true;
  }

  refreshPalette() {
    if (!this.gl || !this.paletteTexture || !this.relationTexture) {
      return;
    }
    this.uploadPalette();
  }

  render() {
    if (!this.gl || !this.program || !this.vao) {
      return;
    }
    const gl = this.gl;

    const uploadStateSpan = FrameProfiler.start();
    this.uploadStateTexture();
    FrameProfiler.end("TerritoryWebGLRenderer:uploadState", uploadStateSpan);

    if (this.contestEnabled) {
      const uploadContestSpan = FrameProfiler.start();
      this.uploadContestTexture();
      FrameProfiler.end(
        "TerritoryWebGLRenderer:uploadContests",
        uploadContestSpan,
      );

      const uploadContestTimesSpan = FrameProfiler.start();
      this.uploadContestTimesTexture();
      FrameProfiler.end(
        "TerritoryWebGLRenderer:uploadContestTimes",
        uploadContestTimesSpan,
      );

      const uploadContestStrengthsSpan = FrameProfiler.start();
      this.uploadContestStrengthsTexture();
      FrameProfiler.end(
        "TerritoryWebGLRenderer:uploadContestStrengths",
        uploadContestStrengthsSpan,
      );
    }

    if (this.jfaSupported) {
      this.updateChangeMask();
      this.updateJfa();
    }

    const renderSpan = FrameProfiler.start();
    gl.viewport(0, 0, this.viewWidth, this.viewHeight);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    const canUseOlderPair =
      this.interpolationPair === "olderPrev" &&
      !!this.prevOwnerTexture &&
      !!this.olderOwnerTexture &&
      !!this.jfaResultOldTexture &&
      !!this.jfaResultOlderTexture;
    const renderPair = canUseOlderPair ? "olderPrev" : "prevCurrent";

    const toStateTexture =
      renderPair === "olderPrev" ? this.prevOwnerTexture : this.stateTexture;
    const fromStateTexture =
      renderPair === "olderPrev"
        ? this.olderOwnerTexture
        : this.prevOwnerTexture;

    if (toStateTexture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, toStateTexture);
    }
    if (this.paletteTexture) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.paletteTexture);
    }
    if (this.relationTexture) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.relationTexture);
    }
    if (this.patternTexture) {
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, this.patternTexture);
    }
    if (this.contestOwnersTexture) {
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, this.contestOwnersTexture);
    }
    if (this.contestIdsTexture) {
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, this.contestIdsTexture);
    }
    if (this.contestTimesTexture) {
      gl.activeTexture(gl.TEXTURE6);
      gl.bindTexture(gl.TEXTURE_2D, this.contestTimesTexture);
    }
    if (fromStateTexture) {
      gl.activeTexture(gl.TEXTURE7);
      gl.bindTexture(gl.TEXTURE_2D, fromStateTexture);
    }

    const seedsOld =
      renderPair === "olderPrev"
        ? this.jfaResultOlderTexture
        : this.jfaResultOldTexture;
    const seedsNew =
      renderPair === "olderPrev"
        ? this.jfaResultOldTexture
        : this.jfaResultNewTexture;
    if (seedsOld) {
      gl.activeTexture(gl.TEXTURE8);
      gl.bindTexture(gl.TEXTURE_2D, seedsOld);
    }
    if (seedsNew) {
      gl.activeTexture(gl.TEXTURE9);
      gl.bindTexture(gl.TEXTURE_2D, seedsNew);
    }

    if (this.stateTexture) {
      gl.activeTexture(gl.TEXTURE12);
      gl.bindTexture(gl.TEXTURE_2D, this.stateTexture);
    }
    if (this.terrainTexture) {
      gl.activeTexture(gl.TEXTURE14);
      gl.bindTexture(gl.TEXTURE_2D, this.terrainTexture);
    }

    const changeMaskTexture =
      renderPair === "olderPrev"
        ? this.changeMaskTextureOld
        : this.changeMaskTextureNew;
    if (changeMaskTexture) {
      gl.activeTexture(gl.TEXTURE13);
      gl.bindTexture(gl.TEXTURE_2D, changeMaskTexture);
    }
    if (this.contestStrengthsTexture) {
      gl.activeTexture(gl.TEXTURE11);
      gl.bindTexture(gl.TEXTURE_2D, this.contestStrengthsTexture);
    }
    if (this.uniforms.viewResolution) {
      gl.uniform2f(
        this.uniforms.viewResolution,
        this.viewWidth,
        this.viewHeight,
      );
    }
    if (this.uniforms.viewScale) {
      gl.uniform1f(this.uniforms.viewScale, this.viewScale);
    }
    if (this.uniforms.viewOffset) {
      gl.uniform2f(
        this.uniforms.viewOffset,
        this.viewOffsetX,
        this.viewOffsetY,
      );
    }
    if (this.uniforms.alternativeView) {
      gl.uniform1i(this.uniforms.alternativeView, this.alternativeView ? 1 : 0);
    }
    if (this.uniforms.hoveredPlayerId) {
      // Disable highlight after 5 seconds
      const now = Date.now();
      const elapsed = now - this.hoverStartTime;
      const activeHoverId =
        this.hoveredPlayerId >= 0 &&
        elapsed < TerritoryWebGLRenderer.HOVER_DURATION_MS
          ? this.hoveredPlayerId
          : -1;
      gl.uniform1f(this.uniforms.hoveredPlayerId, activeHoverId);
    }
    if (this.uniforms.hoverHighlightStrength) {
      gl.uniform1f(
        this.uniforms.hoverHighlightStrength,
        this.hoverHighlightStrength,
      );
    }
    if (this.uniforms.hoverHighlightColor) {
      const [r, g, b] = this.hoverHighlightColor;
      gl.uniform3f(this.uniforms.hoverHighlightColor, r, g, b);
    }
    if (this.uniforms.hoverPulseStrength) {
      gl.uniform1f(this.uniforms.hoverPulseStrength, this.hoverPulseStrength);
    }
    if (this.uniforms.hoverPulseSpeed) {
      gl.uniform1f(this.uniforms.hoverPulseSpeed, this.hoverPulseSpeed);
    }
    if (this.uniforms.time) {
      const currentTime = (Date.now() - this.animationStartTime) / 1000.0;
      gl.uniform1f(this.uniforms.time, currentTime);
    }
    if (this.uniforms.viewerId) {
      const viewerId = this.game.myPlayer()?.smallID() ?? 0;
      gl.uniform1i(this.uniforms.viewerId, viewerId);
    }
    if (this.uniforms.contestEnabled) {
      gl.uniform1i(this.uniforms.contestEnabled, this.contestEnabled ? 1 : 0);
    }
    if (this.uniforms.contestNow) {
      gl.uniform1i(this.uniforms.contestNow, this.contestNow);
    }
    if (this.uniforms.contestDuration) {
      gl.uniform1f(this.uniforms.contestDuration, this.contestDurationTicks);
    }
    if (this.uniforms.smoothProgress) {
      gl.uniform1f(this.uniforms.smoothProgress, this.smoothProgress);
    }
    if (this.uniforms.smoothEnabled) {
      gl.uniform1i(this.uniforms.smoothEnabled, this.smoothEnabled ? 1 : 0);
    }
    if (this.uniforms.darkMode) {
      gl.uniform1i(
        this.uniforms.darkMode,
        this.userSettings.darkMode() ? 1 : 0,
      );
    }

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    FrameProfiler.end("TerritoryWebGLRenderer:draw", renderSpan);
  }

  getDebugStats() {
    return {
      mapWidth: this.mapWidth,
      mapHeight: this.mapHeight,
      viewWidth: this.viewWidth,
      viewHeight: this.viewHeight,
      viewScale: this.viewScale,
      viewOffsetX: this.viewOffsetX,
      viewOffsetY: this.viewOffsetY,
      smoothEnabled: this.smoothEnabled,
      smoothProgress: this.smoothProgress,
      jfaSupported: this.jfaSupported,
      jfaDisabledReason: this.jfaDisabledReason,
      jfaDirty: this.jfaDirty,
      prevStateCopySupported: this.prevStateCopySupported,
      contestDurationTicks: this.contestDurationTicks,
      contestNow: this.contestNow,
      hoveredPlayerId: this.hoveredPlayerId,
    };
  }

  private uploadStateTexture(): { rows: number; bytes: number } {
    if (!this.gl || !this.stateTexture) return { rows: 0, bytes: 0 };
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.stateTexture);

    const bytesPerPixel = Uint16Array.BYTES_PER_ELEMENT;
    let rowsUploaded = 0;
    let bytesUploaded = 0;

    if (this.needsFullUpload) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R16UI,
        this.mapWidth,
        this.mapHeight,
        0,
        gl.RED_INTEGER,
        gl.UNSIGNED_SHORT,
        this.state,
      );
      this.needsFullUpload = false;
      this.dirtyRows.clear();
      rowsUploaded = this.mapHeight;
      bytesUploaded = this.mapWidth * this.mapHeight * bytesPerPixel;
      return { rows: rowsUploaded, bytes: bytesUploaded };
    }

    if (this.dirtyRows.size === 0) {
      return { rows: 0, bytes: 0 };
    }

    for (const [y, span] of this.dirtyRows) {
      const width = span.maxX - span.minX + 1;
      const offset = y * this.mapWidth + span.minX;
      const rowSlice = this.state.subarray(offset, offset + width);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        span.minX,
        y,
        width,
        1,
        gl.RED_INTEGER,
        gl.UNSIGNED_SHORT,
        rowSlice,
      );
      rowsUploaded++;
      bytesUploaded += width * bytesPerPixel;
    }
    this.dirtyRows.clear();
    return { rows: rowsUploaded, bytes: bytesUploaded };
  }

  private uploadContestTexture(): { rows: number; bytes: number } {
    if (!this.gl || !this.contestOwnersTexture || !this.contestIdsTexture) {
      return { rows: 0, bytes: 0 };
    }
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    const bytesPerOwnerPixel = Uint16Array.BYTES_PER_ELEMENT * 2;
    const bytesPerIdPixel = Uint16Array.BYTES_PER_ELEMENT;
    let rowsUploaded = 0;
    let bytesUploaded = 0;

    if (this.needsContestFullUpload) {
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, this.contestOwnersTexture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RG16UI,
        this.mapWidth,
        this.mapHeight,
        0,
        gl.RG_INTEGER,
        gl.UNSIGNED_SHORT,
        this.contestOwnersState,
      );

      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, this.contestIdsTexture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R16UI,
        this.mapWidth,
        this.mapHeight,
        0,
        gl.RED_INTEGER,
        gl.UNSIGNED_SHORT,
        this.contestIdsState,
      );

      this.needsContestFullUpload = false;
      this.contestDirtyRows.clear();
      rowsUploaded = this.mapHeight;
      bytesUploaded =
        this.mapWidth * this.mapHeight * (bytesPerOwnerPixel + bytesPerIdPixel);
      return { rows: rowsUploaded, bytes: bytesUploaded };
    }

    if (this.contestDirtyRows.size === 0) {
      return { rows: 0, bytes: 0 };
    }

    for (const [y, span] of this.contestDirtyRows) {
      const width = span.maxX - span.minX + 1;
      const ownerOffset = (y * this.mapWidth + span.minX) * 2;
      const ownerSlice = this.contestOwnersState.subarray(
        ownerOffset,
        ownerOffset + width * 2,
      );

      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, this.contestOwnersTexture);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        span.minX,
        y,
        width,
        1,
        gl.RG_INTEGER,
        gl.UNSIGNED_SHORT,
        ownerSlice,
      );

      const idOffset = y * this.mapWidth + span.minX;
      const idSlice = this.contestIdsState.subarray(idOffset, idOffset + width);
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, this.contestIdsTexture);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        span.minX,
        y,
        width,
        1,
        gl.RED_INTEGER,
        gl.UNSIGNED_SHORT,
        idSlice,
      );

      rowsUploaded++;
      bytesUploaded += width * (bytesPerOwnerPixel + bytesPerIdPixel);
    }
    this.contestDirtyRows.clear();
    return { rows: rowsUploaded, bytes: bytesUploaded };
  }

  private uploadContestTimesTexture(): { rows: number; bytes: number } {
    if (!this.gl || !this.contestTimesTexture) {
      return { rows: 0, bytes: 0 };
    }
    if (!this.needsContestTimesUpload) {
      return { rows: 0, bytes: 0 };
    }
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, this.contestTimesTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R16UI,
      this.contestTimesState.length,
      1,
      0,
      gl.RED_INTEGER,
      gl.UNSIGNED_SHORT,
      this.contestTimesState,
    );
    this.needsContestTimesUpload = false;
    const bytes = this.contestTimesState.length * Uint16Array.BYTES_PER_ELEMENT;
    return { rows: 1, bytes };
  }

  private uploadContestStrengthsTexture(): { rows: number; bytes: number } {
    if (!this.gl || !this.contestStrengthsTexture) {
      return { rows: 0, bytes: 0 };
    }
    if (!this.needsContestStrengthsUpload) {
      return { rows: 0, bytes: 0 };
    }
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.activeTexture(gl.TEXTURE11);
    gl.bindTexture(gl.TEXTURE_2D, this.contestStrengthsTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R16UI,
      this.contestStrengthsState.length,
      1,
      0,
      gl.RED_INTEGER,
      gl.UNSIGNED_SHORT,
      this.contestStrengthsState,
    );
    this.needsContestStrengthsUpload = false;
    const bytes =
      this.contestStrengthsState.length * Uint16Array.BYTES_PER_ELEMENT;
    return { rows: 1, bytes };
  }

  private updateChangeMask() {
    if (
      !this.gl ||
      !this.jfaSupported ||
      !this.changeMaskDirty ||
      !this.changeMaskProgram ||
      !this.changeMaskFramebufferNew ||
      !this.changeMaskFramebufferOld ||
      !this.changeMaskFramebufferOlder ||
      !this.prevOwnerTexture ||
      !this.stateTexture ||
      !this.jfaVao
    ) {
      return;
    }

    const gl = this.gl;
    const prevBlend = gl.isEnabled(gl.BLEND);
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, this.mapWidth, this.mapHeight);
    gl.bindVertexArray(this.jfaVao);

    gl.useProgram(this.changeMaskProgram);
    if (this.changeMaskUniforms.resolution) {
      gl.uniform2f(
        this.changeMaskUniforms.resolution,
        this.mapWidth,
        this.mapHeight,
      );
    }
    if (this.changeMaskUniforms.oldTexture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.prevOwnerTexture);
      gl.uniform1i(this.changeMaskUniforms.oldTexture, 0);
    }
    if (this.changeMaskUniforms.newTexture) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.stateTexture);
      gl.uniform1i(this.changeMaskUniforms.newTexture, 1);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.changeMaskFramebufferNew);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    if (!this.changeMaskHistoryInitialized) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.changeMaskFramebufferNew);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.changeMaskFramebufferOld);
      gl.blitFramebuffer(
        0,
        0,
        this.mapWidth,
        this.mapHeight,
        0,
        0,
        this.mapWidth,
        this.mapHeight,
        gl.COLOR_BUFFER_BIT,
        gl.NEAREST,
      );
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.changeMaskFramebufferOlder);
      gl.blitFramebuffer(
        0,
        0,
        this.mapWidth,
        this.mapHeight,
        0,
        0,
        this.mapWidth,
        this.mapHeight,
        gl.COLOR_BUFFER_BIT,
        gl.NEAREST,
      );
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      this.changeMaskHistoryInitialized = true;
    }

    this.changeMaskDirty = false;

    if (prevBlend) {
      gl.enable(gl.BLEND);
    }
  }

  private updateJfa() {
    if (
      !this.gl ||
      !this.jfaSupported ||
      !this.jfaSeedProgram ||
      !this.jfaProgram ||
      !this.jfaFramebufferA ||
      !this.jfaFramebufferB ||
      !this.jfaTextureA ||
      !this.jfaTextureB ||
      !this.stateTexture ||
      !this.jfaResultNewFramebuffer ||
      !this.jfaResultNewTexture ||
      !this.jfaVao
    ) {
      return;
    }
    if (!this.jfaDirty) {
      return;
    }
    const gl = this.gl;
    const prevBlend = gl.isEnabled(gl.BLEND);
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, this.mapWidth, this.mapHeight);
    gl.bindVertexArray(this.jfaVao);

    const runJfa = (
      ownerTexture: WebGLTexture,
      resultFramebuffer: WebGLFramebuffer,
    ) => {
      gl.useProgram(this.jfaSeedProgram);
      if (this.jfaSeedUniforms.resolution) {
        gl.uniform2f(
          this.jfaSeedUniforms.resolution,
          this.mapWidth,
          this.mapHeight,
        );
      }
      if (this.jfaSeedUniforms.owner) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, ownerTexture);
        gl.uniform1i(this.jfaSeedUniforms.owner, 0);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.jfaFramebufferA);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      let readTex = this.jfaTextureA;
      let readFbo = this.jfaFramebufferA;
      let writeFbo = this.jfaFramebufferB;
      let writeTex = this.jfaTextureB;
      for (const step of this.jfaSteps) {
        gl.useProgram(this.jfaProgram);
        if (this.jfaUniforms.resolution) {
          gl.uniform2f(
            this.jfaUniforms.resolution,
            this.mapWidth,
            this.mapHeight,
          );
        }
        if (this.jfaUniforms.step) {
          gl.uniform1f(this.jfaUniforms.step, step);
        }
        if (this.jfaUniforms.seeds) {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, readTex);
          gl.uniform1i(this.jfaUniforms.seeds, 0);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, writeFbo);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        const tempTex = readTex;
        readTex = writeTex;
        writeTex = tempTex;
        const tempFbo = readFbo;
        readFbo = writeFbo;
        writeFbo = tempFbo;
      }

      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, resultFramebuffer);
      gl.blitFramebuffer(
        0,
        0,
        this.mapWidth,
        this.mapHeight,
        0,
        0,
        this.mapWidth,
        this.mapHeight,
        gl.COLOR_BUFFER_BIT,
        gl.NEAREST,
      );
    };

    runJfa(this.stateTexture, this.jfaResultNewFramebuffer);

    this.jfaDirty = false;

    if (
      !this.jfaHistoryInitialized &&
      this.jfaResultOlderFramebuffer &&
      this.jfaResultOldFramebuffer
    ) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.jfaResultNewFramebuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.jfaResultOldFramebuffer);
      gl.blitFramebuffer(
        0,
        0,
        this.mapWidth,
        this.mapHeight,
        0,
        0,
        this.mapWidth,
        this.mapHeight,
        gl.COLOR_BUFFER_BIT,
        gl.NEAREST,
      );
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.jfaResultOlderFramebuffer);
      gl.blitFramebuffer(
        0,
        0,
        this.mapWidth,
        this.mapHeight,
        0,
        0,
        this.mapWidth,
        this.mapHeight,
        gl.COLOR_BUFFER_BIT,
        gl.NEAREST,
      );
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      this.jfaHistoryInitialized = true;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (prevBlend) {
      gl.enable(gl.BLEND);
    }
    gl.bindVertexArray(null);
  }

  private buildJfaSteps(width: number, height: number): number[] {
    const maxDim = Math.max(width, height);
    let step = 1;
    while (step < maxDim) {
      step <<= 1;
    }
    step >>= 1;
    const steps: number[] = [];
    while (step >= 1) {
      steps.push(step);
      step >>= 1;
    }
    return steps;
  }

  private uploadPalette() {
    if (
      !this.gl ||
      !this.paletteTexture ||
      !this.relationTexture ||
      !this.patternTexture ||
      !this.program
    )
      return;
    const gl = this.gl;
    const players = this.game.playerViews().filter((p) => p.isPlayer());

    const maxId = players.reduce((max, p) => Math.max(max, p.smallID()), 0) + 1;
    this.paletteWidth = Math.max(maxId, 1);

    const paletteData = new Uint8Array(this.paletteWidth * 8);
    const relationData = new Uint8Array(this.paletteWidth * this.paletteWidth);
    const patternData = new Uint8Array(
      this.paletteWidth * PATTERN_STRIDE_BYTES,
    );

    const patternsEnabled = this.userSettings.territoryPatterns();
    const defaultPatternBytes = this.getPatternBytes(
      DefaultPattern.patternData,
    );

    for (const p of players) {
      const id = p.smallID();
      const territoryRgba = p.territoryColor().rgba;
      paletteData[id * 8] = territoryRgba.r;
      paletteData[id * 8 + 1] = territoryRgba.g;
      paletteData[id * 8 + 2] = territoryRgba.b;
      paletteData[id * 8 + 3] = Math.round((territoryRgba.a ?? 1) * 255);

      const borderRgba = p.borderColor().rgba;
      paletteData[id * 8 + 4] = borderRgba.r;
      paletteData[id * 8 + 5] = borderRgba.g;
      paletteData[id * 8 + 6] = borderRgba.b;
      paletteData[id * 8 + 7] = Math.round((borderRgba.a ?? 1) * 255);

      const patternBytes =
        patternsEnabled && p.cosmetics.pattern
          ? this.getPatternBytes(p.cosmetics.pattern.patternData)
          : defaultPatternBytes;
      const offset = id * PATTERN_STRIDE_BYTES;
      patternData.set(patternBytes.slice(0, PATTERN_STRIDE_BYTES), offset);
    }

    for (let ownerId = 0; ownerId < this.paletteWidth; ownerId++) {
      const owner = this.safePlayerBySmallId(ownerId);
      for (let otherId = 0; otherId < this.paletteWidth; otherId++) {
        const other = this.safePlayerBySmallId(otherId);
        relationData[ownerId * this.paletteWidth + otherId] =
          this.resolveRelationCode(owner, other);
      }
    }

    gl.useProgram(this.program);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      this.paletteWidth * 2,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      paletteData,
    );

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.relationTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8UI,
      this.paletteWidth,
      this.paletteWidth,
      0,
      gl.RED_INTEGER,
      gl.UNSIGNED_BYTE,
      relationData,
    );

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.patternTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8UI,
      PATTERN_STRIDE_BYTES,
      this.paletteWidth,
      0,
      gl.RED_INTEGER,
      gl.UNSIGNED_BYTE,
      patternData,
    );

    if (this.uniforms.patternStride) {
      gl.uniform1i(this.uniforms.patternStride, PATTERN_STRIDE_BYTES);
    }
    if (this.uniforms.patternRows) {
      gl.uniform1i(this.uniforms.patternRows, this.paletteWidth);
    }
  }

  private resolveRelationCode(
    owner: PlayerView | null,
    other: PlayerView | null,
  ): number {
    if (!owner || !other || !owner.isPlayer() || !other.isPlayer()) {
      return 0;
    }

    let code = 0;
    if (owner.smallID() === other.smallID()) {
      code |= 4;
    }
    if (owner.isFriendly(other) || other.isFriendly(owner)) {
      code |= 1;
    }
    if (owner.hasEmbargo(other)) {
      code |= 2;
    }
    return code;
  }

  private safePlayerBySmallId(id: number): PlayerView | null {
    const player = this.game.playerBySmallID(id);
    return player instanceof PlayerView ? player : null;
  }

  private getPatternBytes(patternData: string): Uint8Array {
    const cached = this.patternBytesCache.get(patternData);
    if (cached) {
      return cached;
    }
    try {
      const bytes = base64url.decode(patternData);
      this.patternBytesCache.set(patternData, bytes);
      return bytes;
    } catch (error) {
      const fallback = base64url.decode(DefaultPattern.patternData);
      this.patternBytesCache.set(patternData, fallback);
      return fallback;
    }
  }

  private createJfaSeedProgram(
    gl: WebGL2RenderingContext,
  ): WebGLProgram | null {
    const vertexShaderSource = `#version 300 es
      precision highp float;
      layout(location = 0) in vec2 a_position;
      uniform vec2 u_resolution;
      void main() {
        vec2 zeroToOne = a_position / u_resolution;
        vec2 clipSpace = zeroToOne * 2.0 - 1.0;
        clipSpace.y = -clipSpace.y;
        gl_Position = vec4(clipSpace, 0.0, 1.0);
      }
    `;

    const fragmentShaderSource = `#version 300 es
      precision highp float;
      precision highp usampler2D;

      uniform usampler2D u_ownerTexture;
      uniform vec2 u_resolution;

      out vec2 outSeed;

      uint ownerAt(ivec2 texCoord) {
        ivec2 clamped = clamp(
          texCoord,
          ivec2(0, 0),
          ivec2(int(u_resolution.x) - 1, int(u_resolution.y) - 1)
        );
        return texelFetch(u_ownerTexture, clamped, 0).r & 0xFFFu;
      }

      void main() {
        ivec2 fragCoord = ivec2(gl_FragCoord.xy);
        ivec2 texCoord = ivec2(
          fragCoord.x,
          int(u_resolution.y) - 1 - fragCoord.y
        );

        uint owner = ownerAt(texCoord);
        bool isBorder = false;
        uint nOwner = ownerAt(texCoord + ivec2(1, 0));
        isBorder = isBorder || (nOwner != owner);
        nOwner = ownerAt(texCoord + ivec2(-1, 0));
        isBorder = isBorder || (nOwner != owner);
        nOwner = ownerAt(texCoord + ivec2(0, 1));
        isBorder = isBorder || (nOwner != owner);
        nOwner = ownerAt(texCoord + ivec2(0, -1));
        isBorder = isBorder || (nOwner != owner);

	        // Seed in map-space at the *tile center* so we can later interpret the
	        // boundary as half a tile away (distance-to-edge = distance-to-center - 0.5).
	        outSeed = isBorder ? (vec2(texCoord) + vec2(0.5)) : vec2(-1.0, -1.0);
	      }
	    `;

    const vertexShader = this.compileShader(
      gl,
      gl.VERTEX_SHADER,
      vertexShaderSource,
    );
    const fragmentShader = this.compileShader(
      gl,
      gl.FRAGMENT_SHADER,
      fragmentShaderSource,
    );
    if (!vertexShader || !fragmentShader) {
      return null;
    }

    const program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(
        "[TerritoryWebGLRenderer] JFA seed link error",
        gl.getProgramInfoLog(program),
      );
      gl.deleteProgram(program);
      return null;
    }
    return program;
  }

  private createJfaProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
    const vertexShaderSource = `#version 300 es
      precision highp float;
      layout(location = 0) in vec2 a_position;
      uniform vec2 u_resolution;
      void main() {
        vec2 zeroToOne = a_position / u_resolution;
        vec2 clipSpace = zeroToOne * 2.0 - 1.0;
        clipSpace.y = -clipSpace.y;
        gl_Position = vec4(clipSpace, 0.0, 1.0);
      }
    `;

    const fragmentShaderSource = `#version 300 es
      precision highp float;

      uniform sampler2D u_seeds;
      uniform vec2 u_resolution;
      uniform float u_step;

      out vec2 outSeed;

      vec2 seedAt(ivec2 texCoord) {
        ivec2 clamped = clamp(
          texCoord,
          ivec2(0, 0),
          ivec2(int(u_resolution.x) - 1, int(u_resolution.y) - 1)
        );
        return texelFetch(u_seeds, clamped, 0).rg;
      }

	      void considerSeed(ivec2 coord, ivec2 texCoord, inout vec2 bestSeed, inout float bestDist) {
	        vec2 seed = seedAt(coord);
	        if (seed.x < 0.0) {
	          return;
	        }
	        float dist = length(seed - (vec2(texCoord) + vec2(0.5)));
	        if (dist < bestDist) {
	          bestDist = dist;
	          bestSeed = seed;
	        }
	      }

      void main() {
        ivec2 fragCoord = ivec2(gl_FragCoord.xy);
        ivec2 texCoord = ivec2(
          fragCoord.x,
          int(u_resolution.y) - 1 - fragCoord.y
        );
        int step = int(u_step + 0.5);

	        vec2 bestSeed = seedAt(texCoord);
	        vec2 texPos = vec2(texCoord) + vec2(0.5);
	        float bestDist = bestSeed.x < 0.0 ? 1e20 : length(bestSeed - texPos);

        considerSeed(texCoord + ivec2(-step, -step), texCoord, bestSeed, bestDist);
        considerSeed(texCoord + ivec2(0, -step), texCoord, bestSeed, bestDist);
        considerSeed(texCoord + ivec2(step, -step), texCoord, bestSeed, bestDist);
        considerSeed(texCoord + ivec2(-step, 0), texCoord, bestSeed, bestDist);
        considerSeed(texCoord + ivec2(step, 0), texCoord, bestSeed, bestDist);
        considerSeed(texCoord + ivec2(-step, step), texCoord, bestSeed, bestDist);
        considerSeed(texCoord + ivec2(0, step), texCoord, bestSeed, bestDist);
        considerSeed(texCoord + ivec2(step, step), texCoord, bestSeed, bestDist);

        outSeed = bestSeed;
      }
    `;

    const vertexShader = this.compileShader(
      gl,
      gl.VERTEX_SHADER,
      vertexShaderSource,
    );
    const fragmentShader = this.compileShader(
      gl,
      gl.FRAGMENT_SHADER,
      fragmentShaderSource,
    );
    if (!vertexShader || !fragmentShader) {
      return null;
    }

    const program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(
        "[TerritoryWebGLRenderer] JFA link error",
        gl.getProgramInfoLog(program),
      );
      gl.deleteProgram(program);
      return null;
    }
    return program;
  }

  private createChangeMaskProgram(
    gl: WebGL2RenderingContext,
  ): WebGLProgram | null {
    const vertexShaderSource = `#version 300 es
      precision highp float;
      layout(location = 0) in vec2 a_position;
      uniform vec2 u_resolution;
      void main() {
        vec2 zeroToOne = a_position / u_resolution;
        vec2 clipSpace = zeroToOne * 2.0 - 1.0;
        clipSpace.y = -clipSpace.y;
        gl_Position = vec4(clipSpace, 0.0, 1.0);
      }
    `;

    const fragmentShaderSource = `#version 300 es
      precision highp float;
      precision highp usampler2D;

      uniform usampler2D u_oldTexture;
      uniform usampler2D u_newTexture;
      uniform vec2 u_resolution;

      layout(location = 0) out uint outMask;

      uint ownerAt(usampler2D tex, ivec2 texCoord) {
        ivec2 clamped = clamp(
          texCoord,
          ivec2(0, 0),
          ivec2(int(u_resolution.x) - 1, int(u_resolution.y) - 1)
        );
        return texelFetch(tex, clamped, 0).r & 0xFFFu;
      }

      void main() {
        ivec2 fragCoord = ivec2(gl_FragCoord.xy);
        ivec2 texCoord = ivec2(
          fragCoord.x,
          int(u_resolution.y) - 1 - fragCoord.y
        );

        bool changed = ownerAt(u_oldTexture, texCoord) != ownerAt(u_newTexture, texCoord);
        changed = changed || (ownerAt(u_oldTexture, texCoord + ivec2(1, 0)) != ownerAt(u_newTexture, texCoord + ivec2(1, 0)));
        changed = changed || (ownerAt(u_oldTexture, texCoord + ivec2(-1, 0)) != ownerAt(u_newTexture, texCoord + ivec2(-1, 0)));
        changed = changed || (ownerAt(u_oldTexture, texCoord + ivec2(0, 1)) != ownerAt(u_newTexture, texCoord + ivec2(0, 1)));
        changed = changed || (ownerAt(u_oldTexture, texCoord + ivec2(0, -1)) != ownerAt(u_newTexture, texCoord + ivec2(0, -1)));

        outMask = changed ? 1u : 0u;
      }
    `;

    const vertexShader = this.compileShader(
      gl,
      gl.VERTEX_SHADER,
      vertexShaderSource,
    );
    const fragmentShader = this.compileShader(
      gl,
      gl.FRAGMENT_SHADER,
      fragmentShaderSource,
    );
    if (!vertexShader || !fragmentShader) {
      return null;
    }

    const program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(
        "[TerritoryWebGLRenderer] change mask link error",
        gl.getProgramInfoLog(program),
      );
      gl.deleteProgram(program);
      return null;
    }
    return program;
  }

  private createProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
    const vertexShaderSource = `#version 300 es
      precision highp float;
      layout(location = 0) in vec2 a_position;
      uniform vec2 u_viewResolution;
      void main() {
        vec2 zeroToOne = a_position / u_viewResolution;
        vec2 clipSpace = zeroToOne * 2.0 - 1.0;
        clipSpace.y = -clipSpace.y;
        gl_Position = vec4(clipSpace, 0.0, 1.0);
      }
    `;

    const fragmentShaderSource = `#version 300 es
	      precision highp float;
	      precision highp usampler2D;

	      uniform usampler2D u_state;
	      uniform usampler2D u_terrain;
	      uniform usampler2D u_latestState;
	      uniform sampler2D u_palette;
	      uniform usampler2D u_relations;
	      uniform usampler2D u_patterns;
	      uniform bool u_contestEnabled;
	      uniform usampler2D u_contestOwners;
	      uniform usampler2D u_contestIds;
	      uniform usampler2D u_contestTimes;
	      uniform usampler2D u_contestStrengths;
	      uniform bool u_jfaAvailable;
      uniform int u_contestNow;
      uniform float u_contestDurationTicks;
      uniform usampler2D u_prevOwner;
      uniform usampler2D u_changeMask;
      uniform sampler2D u_jfaSeedsOld;
      uniform sampler2D u_jfaSeedsNew;
      uniform float u_smoothProgress;
      uniform bool u_smoothEnabled;
      uniform int u_patternStride;
      uniform int u_patternRows;
      uniform int u_viewerId;
      uniform vec2 u_mapResolution;
      uniform vec2 u_viewResolution;
      uniform float u_viewScale;
      uniform vec2 u_viewOffset;
      uniform vec4 u_fallout;
      uniform vec4 u_altSelf;
      uniform vec4 u_altAlly;
      uniform vec4 u_altNeutral;
      uniform vec4 u_altEnemy;
      uniform float u_alpha;
      uniform bool u_alternativeView;
      uniform float u_hoveredPlayerId;
      uniform vec3 u_hoverHighlightColor;
      uniform float u_hoverHighlightStrength;
      uniform float u_hoverPulseStrength;
      uniform float u_hoverPulseSpeed;
      uniform float u_time;
      uniform bool u_darkMode;

      out vec4 outColor;

      uint ownerAtTex(ivec2 texCoord) {
        ivec2 clamped = clamp(
          texCoord,
          ivec2(0, 0),
          ivec2(int(u_mapResolution.x) - 1, int(u_mapResolution.y) - 1)
        );
        return texelFetch(u_state, clamped, 0).r & 0xFFFu;
      }

      // Terrain bit layout: bit7=land, bit6=shoreline, bit5=ocean, bits0-4=magnitude
      uint terrainAtTex(ivec2 texCoord) {
        ivec2 clamped = clamp(
          texCoord,
          ivec2(0, 0),
          ivec2(int(u_mapResolution.x) - 1, int(u_mapResolution.y) - 1)
        );
        return texelFetch(u_terrain, clamped, 0).r;
      }

      bool isLand(uint terrain) {
        return (terrain & 0x80u) != 0u;  // bit 7
      }

      bool isShoreline(uint terrain) {
        return (terrain & 0x40u) != 0u;  // bit 6
      }

      bool isOcean(uint terrain) {
        return (terrain & 0x20u) != 0u;  // bit 5
      }

      uint getMagnitude(uint terrain) {
        return terrain & 0x1Fu;  // bits 0-4
      }

      // Compute terrain color based on type, magnitude, and theme
      // Colors match PastelTheme (light) and PastelThemeDark exactly
      vec3 terrainColor(uint terrain) {
        uint mag = getMagnitude(terrain);
        float fmag = float(mag);

        if (isLand(terrain)) {
          if (isShoreline(terrain)) {
            // Shore/beach - land adjacent to water
            // Light: rgb(204,203,158), Dark: rgb(134,133,88)
            return u_darkMode
              ? vec3(134.0/255.0, 133.0/255.0, 88.0/255.0)
              : vec3(204.0/255.0, 203.0/255.0, 158.0/255.0);
          }
          if (mag < 10u) {
            // Plains (mag 0-9)
            // Light: rgb(190, 220-2*mag, 138), Dark: rgb(140, 170-2*mag, 88)
            return u_darkMode
              ? vec3(140.0/255.0, (170.0 - 2.0*fmag)/255.0, 88.0/255.0)
              : vec3(190.0/255.0, (220.0 - 2.0*fmag)/255.0, 138.0/255.0);
          } else if (mag < 20u) {
            // Highland (mag 10-19)
            // Light: rgb(200+2*mag, 183+2*mag, 138+2*mag)
            // Dark: rgb(150+2*mag, 133+2*mag, 88+2*mag)
            return u_darkMode
              ? vec3((150.0 + 2.0*fmag)/255.0, (133.0 + 2.0*fmag)/255.0, (88.0 + 2.0*fmag)/255.0)
              : vec3((200.0 + 2.0*fmag)/255.0, (183.0 + 2.0*fmag)/255.0, (138.0 + 2.0*fmag)/255.0);
          } else {
            // Mountain (mag 20-30)
            // Light: rgb(230+mag/2, 230+mag/2, 230+mag/2)
            // Dark: rgb(180+mag/2, 180+mag/2, 180+mag/2)
            float base = u_darkMode ? 180.0 : 230.0;
            float val = (base + fmag/2.0) / 255.0;
            return vec3(val, val, val);
          }
        } else {
          // Water
          if (isShoreline(terrain)) {
            // Shoreline water - lighter, adjacent to land
            // Light: rgb(100,143,255), Dark: rgb(50,50,50)
            return u_darkMode
              ? vec3(50.0/255.0, 50.0/255.0, 50.0/255.0)
              : vec3(100.0/255.0, 143.0/255.0, 255.0/255.0);
          }
          if (isOcean(terrain)) {
            // Ocean - depth-adjusted
            // Light base: rgb(70,132,180), adjusted by +1-min(mag,10)
            // Dark base: rgb(14,11,30), adjusted by +9-mag for mag<10
            float depthAdj = float(min(mag, 10u));
            if (u_darkMode) {
              // Dark: rgb(14+9-mag, 11+9-mag, 30+9-mag) for mag<10, else rgb(14,11,30)
              if (mag < 10u) {
                return vec3(
                  (14.0 + 9.0 - fmag)/255.0,
                  (11.0 + 9.0 - fmag)/255.0,
                  (30.0 + 9.0 - fmag)/255.0
                );
              }
              return vec3(14.0/255.0, 11.0/255.0, 30.0/255.0);
            } else {
              // Light: rgb(70-10+11-min(mag,10), 132-10+11-min(mag,10), 180-10+11-min(mag,10))
              // = rgb(71-depthAdj, 133-depthAdj, 181-depthAdj)
              return vec3(
                (71.0 - depthAdj)/255.0,
                (133.0 - depthAdj)/255.0,
                (181.0 - depthAdj)/255.0
              );
            }
          } else {
            // Lake - use same as shoreline water for simplicity
            // Light: rgb(100,143,255), Dark: rgb(50,50,50)
            return u_darkMode
              ? vec3(50.0/255.0, 50.0/255.0, 50.0/255.0)
              : vec3(100.0/255.0, 143.0/255.0, 255.0/255.0);
          }
        }
      }

      uint prevOwnerAtTex(ivec2 texCoord) {
        ivec2 clamped = clamp(
          texCoord,
          ivec2(0, 0),
          ivec2(int(u_mapResolution.x) - 1, int(u_mapResolution.y) - 1)
        );
        return texelFetch(u_prevOwner, clamped, 0).r & 0xFFFu;
      }

      vec2 jfaSeedOldAtTex(ivec2 texCoord) {
        ivec2 clamped = clamp(
          texCoord,
          ivec2(0, 0),
          ivec2(int(u_mapResolution.x) - 1, int(u_mapResolution.y) - 1)
        );
        return texelFetch(u_jfaSeedsOld, clamped, 0).rg;
      }

      vec2 jfaSeedNewAtTex(ivec2 texCoord) {
        ivec2 clamped = clamp(
          texCoord,
          ivec2(0, 0),
          ivec2(int(u_mapResolution.x) - 1, int(u_mapResolution.y) - 1)
        );
        return texelFetch(u_jfaSeedsNew, clamped, 0).rg;
      }

      uvec2 contestOwnersAtTex(ivec2 texCoord) {
        ivec2 clamped = clamp(
          texCoord,
          ivec2(0, 0),
          ivec2(int(u_mapResolution.x) - 1, int(u_mapResolution.y) - 1)
        );
        return texelFetch(u_contestOwners, clamped, 0).rg;
      }

      uint contestIdRawAtTex(ivec2 texCoord) {
        ivec2 clamped = clamp(
          texCoord,
          ivec2(0, 0),
          ivec2(int(u_mapResolution.x) - 1, int(u_mapResolution.y) - 1)
        );
        return texelFetch(u_contestIds, clamped, 0).r;
      }

      float contestStrength(uint contestId) {
        if (contestId == 0u) {
          return 0.5;
        }
        uint strengthRaw = texelFetch(
          u_contestStrengths,
          ivec2(int(contestId), 0),
          0
        ).r;
        return clamp(float(strengthRaw) / 65535.0, 0.0, 1.0);
      }

      float blueNoise(ivec2 texCoord) {
        vec2 p = vec2(texCoord);
        float x = fract(0.06711056 * p.x + 0.00583715 * p.y);
        return fract(52.9829189 * x);
      }

      uint relationCode(uint owner, uint other) {
        if (owner == 0u || other == 0u) {
          return 0u;
        }
        return texelFetch(u_relations, ivec2(int(owner), int(other)), 0).r;
      }

      bool isFriendly(uint code) {
        return (code & 1u) != 0u;
      }

      bool isEmbargo(uint code) {
        return (code & 2u) != 0u;
      }

      bool isSelf(uint code) {
        return (code & 4u) != 0u;
      }

      uint patternByte(uint owner, uint offset) {
        int x = int(offset);
        int y = int(owner);
        if (x < 0 || x >= u_patternStride || y < 0 || y >= u_patternRows) {
          return 0u;
        }
        return texelFetch(u_patterns, ivec2(x, y), 0).r;
      }

      bool patternIsPrimary(uint owner, ivec2 texCoord) {
        uint version = patternByte(owner, 0u);
        if (version != 0u) {
          return true;
        }
        uint b1 = patternByte(owner, 1u);
        uint b2 = patternByte(owner, 2u);
        uint scale = b1 & 7u;
        uint width = (((b2 & 3u) << 5) | ((b1 >> 3) & 31u)) + 2u;
        uint height = ((b2 >> 2) & 63u) + 2u;
        if (width == 0u || height == 0u) {
          return true;
        }
        uint px = (uint(texCoord.x) >> scale) % width;
        uint py = (uint(texCoord.y) >> scale) % height;
        uint idx = py * width + px;
        uint byteIndex = idx >> 3;
        uint bitIndex = idx & 7u;
        uint byteVal = patternByte(owner, 3u + byteIndex);
        return (byteVal & (1u << bitIndex)) == 0u;
      }

      vec3 applyDefended(vec3 color, bool defended, ivec2 texCoord) {
        if (!defended) {
          return color;
        }
        bool isLightTile = ((texCoord.x % 2) == (texCoord.y % 2));
        const float LIGHT_FACTOR = 1.2;
        const float DARK_FACTOR = 0.8;
        return color * (isLightTile ? LIGHT_FACTOR : DARK_FACTOR);
      }

	      void main() {
	        // gl_FragCoord.xy is already at pixel center (0.5, 0.5 ...).
	        // Use the pixel center to avoid half-pixel snapping/offset artifacts,
	        // especially noticeable on the interpolated JFA border/front.
	        vec2 viewCoord = vec2(
	          gl_FragCoord.x - 0.5,
	          u_viewResolution.y - gl_FragCoord.y - 0.5
	        );
	        vec2 mapHalf = u_mapResolution * 0.5;
	        vec2 mapCoord = (viewCoord - mapHalf) / u_viewScale + u_viewOffset + mapHalf;
        if (
          mapCoord.x < 0.0 ||
          mapCoord.y < 0.0 ||
          mapCoord.x >= u_mapResolution.x ||
          mapCoord.y >= u_mapResolution.y
        ) {
          outColor = vec4(0.0);
          return;
        }
        // Tile centers are at (0.5, 1.5, 2.5, ...). Floor gives the tile index.
        // Original ivec2(mapCoord) is equivalent but less explicit.
        ivec2 texCoord = ivec2(mapCoord);

        uint state = texelFetch(u_state, texCoord, 0).r;
        uint owner = state & 0xFFFu;
        bool hasFallout = (state & 0x2000u) != 0u;
        bool isDefended = (state & 0x1000u) != 0u;
        uint latestState = texelFetch(u_latestState, texCoord, 0).r;
        uint latestOwner = latestState & 0xFFFu;
        uint oldOwner = prevOwnerAtTex(texCoord);
        uint changeMask = texelFetch(u_changeMask, texCoord, 0).r;
	        bool smoothActive = u_smoothEnabled &&
	          u_smoothProgress < 1.0 &&
	          !u_alternativeView &&
	          u_jfaAvailable &&
	          changeMask != 0u;

	        uint contestIdRaw = 0u;
	        const uint CONTEST_ID_MASK = 0x7FFFu;
	        uint contestId = 0u;
	        uvec2 contestOwners = uvec2(0u);
	        uint defender = 0u;
	        bool contested = false;
	        if (u_contestEnabled) {
	          contestIdRaw = contestIdRawAtTex(texCoord);
	          contestId = contestIdRaw & CONTEST_ID_MASK;
	          contestOwners = contestOwnersAtTex(texCoord);
	          defender = contestOwners.r & 0xFFFu;

	          if (contestId != 0u) {
	            uint lastTime = texelFetch(u_contestTimes, ivec2(int(contestId), 0), 0).r;
	            const uint CONTEST_WRAP = 32768u;
	            uint nowTime = uint(u_contestNow);
	            uint elapsed = nowTime >= lastTime
	              ? (nowTime - lastTime)
	              : (CONTEST_WRAP - lastTime + nowTime);
	            contested = float(elapsed) < u_contestDurationTicks;
	          }
	        }

        // Border detection: check if any neighbor has a different owner.
        bool isBorder = false;
        bool hasFriendlyRelation = false;
        bool hasEmbargoRelation = false;
        if (!smoothActive) {
          uint nOwner = ownerAtTex(texCoord + ivec2(1, 0));
          isBorder = isBorder || (nOwner != owner);
          if (nOwner != owner && nOwner != 0u) {
            uint rel = relationCode(owner, nOwner);
            hasEmbargoRelation = hasEmbargoRelation || isEmbargo(rel);
            hasFriendlyRelation = hasFriendlyRelation || isFriendly(rel);
          }

          nOwner = ownerAtTex(texCoord + ivec2(-1, 0));
          isBorder = isBorder || (nOwner != owner);
          if (nOwner != owner && nOwner != 0u) {
            uint rel = relationCode(owner, nOwner);
            hasEmbargoRelation = hasEmbargoRelation || isEmbargo(rel);
            hasFriendlyRelation = hasFriendlyRelation || isFriendly(rel);
          }

          nOwner = ownerAtTex(texCoord + ivec2(0, 1));
          isBorder = isBorder || (nOwner != owner);
          if (nOwner != owner && nOwner != 0u) {
            uint rel = relationCode(owner, nOwner);
            hasEmbargoRelation = hasEmbargoRelation || isEmbargo(rel);
            hasFriendlyRelation = hasFriendlyRelation || isFriendly(rel);
          }

          nOwner = ownerAtTex(texCoord + ivec2(0, -1));
          isBorder = isBorder || (nOwner != owner);
          if (nOwner != owner && nOwner != 0u) {
            uint rel = relationCode(owner, nOwner);
            hasEmbargoRelation = hasEmbargoRelation || isEmbargo(rel);
            hasFriendlyRelation = hasFriendlyRelation || isFriendly(rel);
          }
        }

        // Get terrain for background rendering (needed for both normal and alt view)
        uint terrain = terrainAtTex(texCoord);
        vec3 baseTerrainColor = terrainColor(terrain);

        if (u_alternativeView) {
          // Alt view: terrain + borders only, no territory fill
          vec3 color = baseTerrainColor;
          if (owner != 0u && isBorder) {
            // Only draw borders, not territory fill
            uint relationAlt = relationCode(owner, uint(u_viewerId));
            vec4 altColor = u_altNeutral;
            if (isSelf(relationAlt)) {
              altColor = u_altSelf;
            } else if (isFriendly(relationAlt)) {
              altColor = u_altAlly;
            } else if (isEmbargo(relationAlt)) {
              altColor = u_altEnemy;
            }
            color = altColor.rgb;
          }
          if (u_hoveredPlayerId >= 0.0 && abs(float(owner) - u_hoveredPlayerId) < 0.5) {
            float pulse = u_hoverPulseStrength > 0.0
              ? (1.0 - u_hoverPulseStrength) +
                u_hoverPulseStrength * (0.5 + 0.5 * sin(u_time * u_hoverPulseSpeed))
            : 1.0;
            color = mix(color, u_hoverHighlightColor, u_hoverHighlightStrength * pulse);
          }
          outColor = vec4(color, 1.0);
          return;
        }

        // Normal view: blend territory on top of terrain
        vec3 fillColor = baseTerrainColor;
        vec3 borderColor = vec3(0.0);
        float borderAlpha = 0.0;
        vec3 ownerBase = vec3(0.0);
        vec4 ownerBorder = vec4(0.0);

        if (owner == 0u) {
          // Unowned tile - show terrain (or fallout if irradiated)
          if (hasFallout) {
            // Blend fallout on top of terrain
            fillColor = mix(baseTerrainColor, u_fallout.rgb, u_alpha);
          }
          // Otherwise fillColor is already baseTerrainColor
        } else {
          vec4 base = texelFetch(u_palette, ivec2(int(owner) * 2, 0), 0);
          vec4 baseBorder = texelFetch(
            u_palette,
            ivec2(int(owner) * 2 + 1, 0),
            0
          );
          ownerBase = base.rgb;
          ownerBorder = baseBorder;
          if (isBorder && !smoothActive) {
            vec3 bColor = baseBorder.rgb;

            const float BORDER_TINT_RATIO = 0.35;
            const vec3 FRIENDLY_TINT_TARGET = vec3(0.0, 1.0, 0.0);
            const vec3 EMBARGO_TINT_TARGET = vec3(1.0, 0.0, 0.0);

            if (hasFriendlyRelation) {
              bColor = bColor * (1.0 - BORDER_TINT_RATIO) +
                      FRIENDLY_TINT_TARGET * BORDER_TINT_RATIO;
            }
            if (hasEmbargoRelation) {
              bColor = bColor * (1.0 - BORDER_TINT_RATIO) +
                      EMBARGO_TINT_TARGET * BORDER_TINT_RATIO;
            }

            borderColor = applyDefended(bColor, isDefended, texCoord);
            borderAlpha = baseBorder.a;
          } else {
            bool isPrimary = patternIsPrimary(owner, texCoord);
            vec3 patternColor = isPrimary ? base.rgb : baseBorder.rgb;
            // Blend territory fill on top of terrain
            fillColor = mix(baseTerrainColor, patternColor, u_alpha);
          }
        }

        vec3 color = fillColor;
        bool useContestedFill = false;
        if (contested && latestOwner != 0u) {
          useContestedFill = true;
          vec3 latestOwnerBase = texelFetch(
            u_palette,
            ivec2(int(latestOwner) * 2, 0),
            0
          ).rgb;
          vec3 defenderBase = latestOwnerBase;
          if (defender != 0u) {
            vec4 defenderColor = texelFetch(
              u_palette,
              ivec2(int(defender) * 2, 0),
              0
            );
            defenderBase = defenderColor.rgb;
          }
          float strength = contestStrength(contestId);
          float noise = blueNoise(texCoord);
          vec3 contestColor = noise < strength ? latestOwnerBase : defenderBase;
          // Blend contested fill on top of terrain
          color = mix(baseTerrainColor, contestColor, u_alpha);
        }

        if (!smoothActive && isBorder && owner != 0u) {
          // Blend border on top of terrain
          color = mix(baseTerrainColor, borderColor, borderAlpha);
        }

        if (smoothActive) {
          // Compute old color blended on terrain
          vec3 oldColor = baseTerrainColor;
          if (oldOwner == 0u) {
            if (hasFallout) {
              oldColor = mix(baseTerrainColor, u_fallout.rgb, u_alpha);
            }
            // Otherwise oldColor is already baseTerrainColor
          } else {
            vec4 oldBase = texelFetch(u_palette, ivec2(int(oldOwner) * 2, 0), 0);
            vec4 oldBorder = texelFetch(
              u_palette,
              ivec2(int(oldOwner) * 2 + 1, 0),
              0
            );
            bool oldPrimary = patternIsPrimary(oldOwner, texCoord);
            vec3 oldPatternColor = oldPrimary ? oldBase.rgb : oldBorder.rgb;
            oldColor = mix(baseTerrainColor, oldPatternColor, u_alpha);
          }

          vec2 seedOld = jfaSeedOldAtTex(texCoord);
          vec2 seedNew = jfaSeedNewAtTex(texCoord);
          bool hasOldSeed = seedOld.x >= 0.0;
          bool hasNewSeed = seedNew.x >= 0.0;
          
          // If either seed is invalid, we can't compute meaningful distances
          // for smooth animation - just use the current color
          if (!hasOldSeed || !hasNewSeed) {
            // Skip smooth animation - show current state
          } else {
            float oldDistance = hasOldSeed
              ? max(length(seedOld - mapCoord) - 0.5, 0.0)
              : 1e6;
            float newDistance = hasNewSeed
              ? max(length(seedNew - mapCoord) - 0.5, 0.0)
              : 1e6;
            float maxDistance = max(oldDistance + newDistance, 0.001);
            float edge = u_smoothProgress * maxDistance;
            float phi = oldDistance - edge;

            float showNew = step(phi, 0.0);
            color = mix(oldColor, color, showNew);

            const float FRONT_HALF_WIDTH = 0.5;
            float distToFront = abs(phi);
            float aa = max(fwidth(phi), 0.001);
            float frontBandAlpha =
              1.0 - smoothstep(FRONT_HALF_WIDTH - aa, FRONT_HALF_WIDTH + aa, distToFront);
            if (frontBandAlpha > 0.0) {
            uint borderOwner = phi <= 0.0 ? owner : oldOwner;
            uint otherOwner = phi <= 0.0 ? oldOwner : owner;
            if (borderOwner == 0u) {
              borderOwner = otherOwner;
              otherOwner = 0u;
            }
            if (borderOwner != 0u) {
              vec4 borderBase = texelFetch(
                u_palette,
                ivec2(int(borderOwner) * 2 + 1, 0),
                0
              );
              vec3 bColor = borderBase.rgb;
              if (otherOwner != 0u) {
                uint rel = relationCode(borderOwner, otherOwner);
                const float BORDER_TINT_RATIO = 0.35;
                const vec3 FRIENDLY_TINT_TARGET = vec3(0.0, 1.0, 0.0);
                const vec3 EMBARGO_TINT_TARGET = vec3(1.0, 0.0, 0.0);
                if (isFriendly(rel)) {
                  bColor = bColor * (1.0 - BORDER_TINT_RATIO) +
                          FRIENDLY_TINT_TARGET * BORDER_TINT_RATIO;
                }
                if (isEmbargo(rel)) {
                  bColor = bColor * (1.0 - BORDER_TINT_RATIO) +
                          EMBARGO_TINT_TARGET * BORDER_TINT_RATIO;
                }
              }
              bColor = applyDefended(bColor, isDefended, texCoord);
              // Blend border on top (borders are opaque)
              color = mix(color, bColor, frontBandAlpha * borderBase.a);
            }
          }
          } // end of else (has at least one valid seed)
        }

        bool pendingOwnerChange = latestOwner != owner;
        if (pendingOwnerChange && !useContestedFill && !u_alternativeView) {
          vec3 hintColor = baseTerrainColor;
          if (latestOwner != 0u) {
            vec3 latestColor = texelFetch(
              u_palette,
              ivec2(int(latestOwner) * 2, 0),
              0
            ).rgb;
            hintColor = mix(baseTerrainColor, latestColor, u_alpha * 0.12);
          }
          color = mix(color, hintColor, 0.5);
        }

        if (u_hoveredPlayerId >= 0.0 && abs(float(owner) - u_hoveredPlayerId) < 0.5) {
          float pulse = u_hoverPulseStrength > 0.0
            ? (1.0 - u_hoverPulseStrength) +
              u_hoverPulseStrength * (0.5 + 0.5 * sin(u_time * u_hoverPulseSpeed))
            : 1.0;
          color = mix(color, u_hoverHighlightColor, u_hoverHighlightStrength * pulse);
        }

        // Output fully opaque since we render terrain as background
        outColor = vec4(color, 1.0);
      }
    `;

    const vertexShader = this.compileShader(
      gl,
      gl.VERTEX_SHADER,
      vertexShaderSource,
    );
    const fragmentShader = this.compileShader(
      gl,
      gl.FRAGMENT_SHADER,
      fragmentShaderSource,
    );
    if (!vertexShader || !fragmentShader) {
      return null;
    }

    const program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(
        "[TerritoryWebGLRenderer] link error",
        gl.getProgramInfoLog(program),
      );
      gl.deleteProgram(program);
      return null;
    }
    return program;
  }

  private compileShader(
    gl: WebGL2RenderingContext,
    type: number,
    source: string,
  ): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error(
        "[TerritoryWebGLRenderer] shader error",
        gl.getShaderInfoLog(shader),
      );
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }
}
