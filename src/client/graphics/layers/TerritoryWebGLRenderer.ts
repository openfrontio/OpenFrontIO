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

  private readonly gl: WebGL2RenderingContext | null;
  private readonly program: WebGLProgram | null;
  private readonly vao: WebGLVertexArrayObject | null;
  private readonly vertexBuffer: WebGLBuffer | null;
  private readonly stateTexture: WebGLTexture | null;
  private readonly paletteTexture: WebGLTexture | null;
  private readonly relationTexture: WebGLTexture | null;
  private readonly patternTexture: WebGLTexture | null;
  private readonly contestOwnersTexture: WebGLTexture | null;
  private readonly contestIdsTexture: WebGLTexture | null;
  private readonly contestTimesTexture: WebGLTexture | null;
  private readonly prevOwnerTexture: WebGLTexture | null;
  private readonly changeMaskTexture: WebGLTexture | null;
  private readonly jfaTextureA: WebGLTexture | null;
  private readonly jfaTextureB: WebGLTexture | null;
  private readonly jfaFramebufferA: WebGLFramebuffer | null;
  private readonly jfaFramebufferB: WebGLFramebuffer | null;
  private readonly jfaSeedProgram: WebGLProgram | null;
  private readonly jfaProgram: WebGLProgram | null;
  private readonly jfaSeedUniforms: {
    resolution: WebGLUniformLocation | null;
    prevOwner: WebGLUniformLocation | null;
  };
  private readonly jfaUniforms: {
    resolution: WebGLUniformLocation | null;
    step: WebGLUniformLocation | null;
    seeds: WebGLUniformLocation | null;
  };
  private readonly uniforms: {
    resolution: WebGLUniformLocation | null;
    state: WebGLUniformLocation | null;
    palette: WebGLUniformLocation | null;
    relations: WebGLUniformLocation | null;
    patterns: WebGLUniformLocation | null;
    contestOwners: WebGLUniformLocation | null;
    contestIds: WebGLUniformLocation | null;
    contestTimes: WebGLUniformLocation | null;
    contestNow: WebGLUniformLocation | null;
    contestDuration: WebGLUniformLocation | null;
    prevOwner: WebGLUniformLocation | null;
    changeMask: WebGLUniformLocation | null;
    jfaSeeds: WebGLUniformLocation | null;
    smoothProgress: WebGLUniformLocation | null;
    smoothMaxDistance: WebGLUniformLocation | null;
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
  };

  private readonly state: Uint16Array;
  private contestOwnersState: Uint16Array;
  private contestIdsState: Uint16Array;
  private contestTimesState: Uint16Array;
  private smoothPrevOwnerState: Uint16Array;
  private smoothChangeMaskState: Uint8Array;
  private readonly dirtyRows: Map<number, DirtySpan> = new Map();
  private readonly contestDirtyRows: Map<number, DirtySpan> = new Map();
  private readonly smoothDirtyRows: Map<number, DirtySpan> = new Map();
  private needsFullUpload = true;
  private needsContestFullUpload = true;
  private needsContestTimesUpload = true;
  private needsSmoothFullUpload = true;
  private alternativeView = false;
  private paletteWidth = 0;
  private hoverHighlightStrength = 0.7;
  private hoverHighlightColor: [number, number, number] = [1, 1, 1];
  private hoverPulseStrength = 0.25;
  private hoverPulseSpeed = Math.PI * 2;
  private hoveredPlayerId = -1;
  private animationStartTime = Date.now();
  private contestNow = 0;
  private contestDurationMs = 5000;
  private smoothProgress = 1;
  private smoothMaxDistance = 12;
  private smoothEnabled = false;
  private jfaSupported = false;
  private jfaDirty = false;
  private jfaSteps: number[] = [];
  private jfaResultIsA = true;
  private readonly userSettings = new UserSettings();
  private readonly patternBytesCache = new Map<string, Uint8Array>();

  private constructor(
    private readonly game: GameView,
    private readonly theme: Theme,
    state: Uint16Array,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = game.width();
    this.canvas.height = game.height();

    this.state = state;
    this.contestOwnersState = new Uint16Array(state.length * 2);
    this.contestIdsState = new Uint16Array(state.length);
    this.contestTimesState = new Uint16Array(1);
    this.smoothPrevOwnerState = new Uint16Array(state.length);
    for (let i = 0; i < state.length; i++) {
      this.smoothPrevOwnerState[i] = state[i] & 0x0fff;
    }
    this.smoothChangeMaskState = new Uint8Array(state.length);

    this.gl = this.canvas.getContext("webgl2", {
      premultipliedAlpha: true,
      antialias: false,
      preserveDrawingBuffer: true,
    });

    if (!this.gl) {
      this.program = null;
      this.vao = null;
      this.vertexBuffer = null;
      this.stateTexture = null;
      this.paletteTexture = null;
      this.relationTexture = null;
      this.patternTexture = null;
      this.contestOwnersTexture = null;
      this.contestIdsTexture = null;
      this.contestTimesTexture = null;
      this.prevOwnerTexture = null;
      this.changeMaskTexture = null;
      this.jfaTextureA = null;
      this.jfaTextureB = null;
      this.jfaFramebufferA = null;
      this.jfaFramebufferB = null;
      this.jfaSeedProgram = null;
      this.jfaProgram = null;
      this.jfaSeedUniforms = { resolution: null, prevOwner: null };
      this.jfaUniforms = { resolution: null, step: null, seeds: null };
      this.uniforms = {
        resolution: null,
        state: null,
        palette: null,
        relations: null,
        patterns: null,
        contestOwners: null,
        contestIds: null,
        contestTimes: null,
        contestNow: null,
        contestDuration: null,
        prevOwner: null,
        changeMask: null,
        jfaSeeds: null,
        smoothProgress: null,
        smoothMaxDistance: null,
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
      };
      return;
    }

    const gl = this.gl;
    this.program = this.createProgram(gl);
    if (!this.program) {
      this.vao = null;
      this.vertexBuffer = null;
      this.stateTexture = null;
      this.paletteTexture = null;
      this.relationTexture = null;
      this.patternTexture = null;
      this.contestOwnersTexture = null;
      this.contestIdsTexture = null;
      this.contestTimesTexture = null;
      this.prevOwnerTexture = null;
      this.changeMaskTexture = null;
      this.jfaTextureA = null;
      this.jfaTextureB = null;
      this.jfaFramebufferA = null;
      this.jfaFramebufferB = null;
      this.jfaSeedProgram = null;
      this.jfaProgram = null;
      this.jfaSeedUniforms = { resolution: null, prevOwner: null };
      this.jfaUniforms = { resolution: null, step: null, seeds: null };
      this.uniforms = {
        resolution: null,
        state: null,
        palette: null,
        relations: null,
        patterns: null,
        contestOwners: null,
        contestIds: null,
        contestTimes: null,
        contestNow: null,
        contestDuration: null,
        prevOwner: null,
        changeMask: null,
        jfaSeeds: null,
        smoothProgress: null,
        smoothMaxDistance: null,
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
      };
      return;
    }

    this.jfaSupported = !!gl.getExtension("EXT_color_buffer_float");
    this.jfaSeedProgram = this.jfaSupported
      ? this.createJfaSeedProgram(gl)
      : null;
    this.jfaProgram = this.jfaSupported ? this.createJfaProgram(gl) : null;
    if (!this.jfaSeedProgram || !this.jfaProgram) {
      this.jfaSupported = false;
    }
    this.jfaSeedUniforms = this.jfaSeedProgram
      ? {
          resolution: gl.getUniformLocation(
            this.jfaSeedProgram,
            "u_resolution",
          ),
          prevOwner: gl.getUniformLocation(this.jfaSeedProgram, "u_prevOwner"),
        }
      : { resolution: null, prevOwner: null };
    this.jfaUniforms = this.jfaProgram
      ? {
          resolution: gl.getUniformLocation(this.jfaProgram, "u_resolution"),
          step: gl.getUniformLocation(this.jfaProgram, "u_step"),
          seeds: gl.getUniformLocation(this.jfaProgram, "u_seeds"),
        }
      : { resolution: null, step: null, seeds: null };

    this.uniforms = {
      resolution: gl.getUniformLocation(this.program, "u_resolution"),
      state: gl.getUniformLocation(this.program, "u_state"),
      palette: gl.getUniformLocation(this.program, "u_palette"),
      relations: gl.getUniformLocation(this.program, "u_relations"),
      patterns: gl.getUniformLocation(this.program, "u_patterns"),
      contestOwners: gl.getUniformLocation(this.program, "u_contestOwners"),
      contestIds: gl.getUniformLocation(this.program, "u_contestIds"),
      contestTimes: gl.getUniformLocation(this.program, "u_contestTimes"),
      contestNow: gl.getUniformLocation(this.program, "u_contestNow"),
      contestDuration: gl.getUniformLocation(
        this.program,
        "u_contestDurationMs",
      ),
      prevOwner: gl.getUniformLocation(this.program, "u_prevOwner"),
      changeMask: gl.getUniformLocation(this.program, "u_changeMask"),
      jfaSeeds: gl.getUniformLocation(this.program, "u_jfaSeeds"),
      smoothProgress: gl.getUniformLocation(this.program, "u_smoothProgress"),
      smoothMaxDistance: gl.getUniformLocation(
        this.program,
        "u_smoothMaxDistance",
      ),
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
    };

    // Vertex data: two triangles covering the full map (pixel-perfect).
    const vertices = new Float32Array([
      0,
      0,
      this.canvas.width,
      0,
      0,
      this.canvas.height,
      0,
      this.canvas.height,
      this.canvas.width,
      0,
      this.canvas.width,
      this.canvas.height,
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

    this.stateTexture = gl.createTexture();
    this.paletteTexture = gl.createTexture();
    this.relationTexture = gl.createTexture();
    this.patternTexture = gl.createTexture();
    this.contestOwnersTexture = gl.createTexture();
    this.contestIdsTexture = gl.createTexture();
    this.contestTimesTexture = gl.createTexture();
    this.prevOwnerTexture = gl.createTexture();
    this.changeMaskTexture = gl.createTexture();
    this.jfaTextureA = this.jfaSupported ? gl.createTexture() : null;
    this.jfaTextureB = this.jfaSupported ? gl.createTexture() : null;
    this.jfaFramebufferA = this.jfaSupported ? gl.createFramebuffer() : null;
    this.jfaFramebufferB = this.jfaSupported ? gl.createFramebuffer() : null;

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
      this.canvas.width,
      this.canvas.height,
      0,
      gl.RED_INTEGER,
      gl.UNSIGNED_SHORT,
      this.state,
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
      this.canvas.width,
      this.canvas.height,
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
      this.canvas.width,
      this.canvas.height,
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
      this.canvas.width,
      this.canvas.height,
      0,
      gl.RED_INTEGER,
      gl.UNSIGNED_SHORT,
      this.smoothPrevOwnerState,
    );

    gl.activeTexture(gl.TEXTURE8);
    gl.bindTexture(gl.TEXTURE_2D, this.changeMaskTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8UI,
      this.canvas.width,
      this.canvas.height,
      0,
      gl.RED_INTEGER,
      gl.UNSIGNED_BYTE,
      this.smoothChangeMaskState,
    );

    if (
      this.jfaSupported &&
      this.jfaTextureA &&
      this.jfaTextureB &&
      this.jfaFramebufferA &&
      this.jfaFramebufferB
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
        this.canvas.width,
        this.canvas.height,
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
        this.canvas.width,
        this.canvas.height,
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
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      this.jfaSteps = this.buildJfaSteps(this.canvas.width, this.canvas.height);
      this.jfaDirty = true;
    }

    gl.useProgram(this.program);
    gl.uniform1i(this.uniforms.state, 0);
    gl.uniform1i(this.uniforms.palette, 1);
    gl.uniform1i(this.uniforms.relations, 2);
    gl.uniform1i(this.uniforms.patterns, 3);
    gl.uniform1i(this.uniforms.contestOwners, 4);
    gl.uniform1i(this.uniforms.contestIds, 5);
    gl.uniform1i(this.uniforms.contestTimes, 6);
    gl.uniform1i(this.uniforms.prevOwner, 7);
    gl.uniform1i(this.uniforms.changeMask, 8);
    gl.uniform1i(this.uniforms.jfaSeeds, 9);

    if (this.uniforms.resolution) {
      gl.uniform2f(
        this.uniforms.resolution,
        this.canvas.width,
        this.canvas.height,
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
    if (this.uniforms.contestNow) {
      gl.uniform1i(this.uniforms.contestNow, this.contestNow);
    }
    if (this.uniforms.contestDuration) {
      gl.uniform1f(this.uniforms.contestDuration, this.contestDurationMs);
    }
    if (this.uniforms.smoothProgress) {
      gl.uniform1f(this.uniforms.smoothProgress, this.smoothProgress);
    }
    if (this.uniforms.smoothMaxDistance) {
      gl.uniform1f(this.uniforms.smoothMaxDistance, this.smoothMaxDistance);
    }
    if (this.uniforms.smoothEnabled) {
      gl.uniform1i(this.uniforms.smoothEnabled, this.smoothEnabled ? 1 : 0);
    }

    if (this.jfaSupported && this.jfaTextureA && this.jfaTextureB) {
      gl.activeTexture(gl.TEXTURE9);
      gl.bindTexture(
        gl.TEXTURE_2D,
        this.jfaResultIsA ? this.jfaTextureA : this.jfaTextureB,
      );
    }
    if (this.uniforms.smoothProgress) {
      gl.uniform1f(this.uniforms.smoothProgress, this.smoothProgress);
    }
    if (this.uniforms.smoothMaxDistance) {
      gl.uniform1f(this.uniforms.smoothMaxDistance, this.smoothMaxDistance);
    }
    if (this.uniforms.smoothEnabled) {
      gl.uniform1i(this.uniforms.smoothEnabled, this.smoothEnabled ? 1 : 0);
    }

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
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

  setHoveredPlayerId(playerSmallId: number | null) {
    const encoded = playerSmallId ?? -1;
    this.hoveredPlayerId = encoded;
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

  markTile(tile: TileRef) {
    if (this.needsFullUpload) {
      return;
    }
    const x = tile % this.canvas.width;
    const y = Math.floor(tile / this.canvas.width);
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
    const x = tile % this.canvas.width;
    const y = Math.floor(tile / this.canvas.width);
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

  setContestNow(nowPacked: number, durationMs: number) {
    this.contestNow = nowPacked | 0;
    this.contestDurationMs = Math.max(1, durationMs);
  }

  setSmoothTile(tile: TileRef, previousOwner: number) {
    this.smoothPrevOwnerState[tile] = previousOwner & 0xffff;
    this.smoothChangeMaskState[tile] = 1;
    if (this.needsSmoothFullUpload) {
      this.jfaDirty = true;
      return;
    }
    const x = tile % this.canvas.width;
    const y = Math.floor(tile / this.canvas.width);
    const span = this.smoothDirtyRows.get(y);
    if (span === undefined) {
      this.smoothDirtyRows.set(y, { minX: x, maxX: x });
    } else {
      span.minX = Math.min(span.minX, x);
      span.maxX = Math.max(span.maxX, x);
    }
    this.jfaDirty = true;
  }

  clearSmoothTile(tile: TileRef, currentOwner: number) {
    this.smoothPrevOwnerState[tile] = currentOwner & 0xffff;
    this.smoothChangeMaskState[tile] = 0;
    if (this.needsSmoothFullUpload) {
      this.jfaDirty = true;
      return;
    }
    const x = tile % this.canvas.width;
    const y = Math.floor(tile / this.canvas.width);
    const span = this.smoothDirtyRows.get(y);
    if (span === undefined) {
      this.smoothDirtyRows.set(y, { minX: x, maxX: x });
    } else {
      span.minX = Math.min(span.minX, x);
      span.maxX = Math.max(span.maxX, x);
    }
    this.jfaDirty = true;
  }

  setSmoothProgress(progress: number) {
    this.smoothProgress = Math.max(0, Math.min(1, progress));
  }

  setSmoothMaxDistance(distance: number) {
    this.smoothMaxDistance = Math.max(1, distance);
  }

  setSmoothEnabled(enabled: boolean) {
    this.smoothEnabled = enabled && this.jfaSupported;
  }

  markAllDirty() {
    this.needsFullUpload = true;
    this.dirtyRows.clear();
    this.needsContestFullUpload = true;
    this.needsContestTimesUpload = true;
    this.contestDirtyRows.clear();
    this.needsSmoothFullUpload = true;
    this.smoothDirtyRows.clear();
    this.jfaDirty = true;
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

    const uploadSmoothSpan = FrameProfiler.start();
    this.uploadSmoothTextures();
    FrameProfiler.end("TerritoryWebGLRenderer:uploadSmooth", uploadSmoothSpan);

    if (this.jfaSupported && this.smoothEnabled) {
      this.updateJfa();
    }

    const renderSpan = FrameProfiler.start();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    if (this.uniforms.alternativeView) {
      gl.uniform1i(this.uniforms.alternativeView, this.alternativeView ? 1 : 0);
    }
    if (this.uniforms.hoveredPlayerId) {
      gl.uniform1f(this.uniforms.hoveredPlayerId, this.hoveredPlayerId);
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
    if (this.uniforms.contestNow) {
      gl.uniform1i(this.uniforms.contestNow, this.contestNow);
    }
    if (this.uniforms.contestDuration) {
      gl.uniform1f(this.uniforms.contestDuration, this.contestDurationMs);
    }

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    FrameProfiler.end("TerritoryWebGLRenderer:draw", renderSpan);
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
        this.canvas.width,
        this.canvas.height,
        0,
        gl.RED_INTEGER,
        gl.UNSIGNED_SHORT,
        this.state,
      );
      this.needsFullUpload = false;
      this.dirtyRows.clear();
      rowsUploaded = this.canvas.height;
      bytesUploaded = this.canvas.width * this.canvas.height * bytesPerPixel;
      return { rows: rowsUploaded, bytes: bytesUploaded };
    }

    if (this.dirtyRows.size === 0) {
      return { rows: 0, bytes: 0 };
    }

    for (const [y, span] of this.dirtyRows) {
      const width = span.maxX - span.minX + 1;
      const offset = y * this.canvas.width + span.minX;
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
        this.canvas.width,
        this.canvas.height,
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
        this.canvas.width,
        this.canvas.height,
        0,
        gl.RED_INTEGER,
        gl.UNSIGNED_SHORT,
        this.contestIdsState,
      );

      this.needsContestFullUpload = false;
      this.contestDirtyRows.clear();
      rowsUploaded = this.canvas.height;
      bytesUploaded =
        this.canvas.width *
        this.canvas.height *
        (bytesPerOwnerPixel + bytesPerIdPixel);
      return { rows: rowsUploaded, bytes: bytesUploaded };
    }

    if (this.contestDirtyRows.size === 0) {
      return { rows: 0, bytes: 0 };
    }

    for (const [y, span] of this.contestDirtyRows) {
      const width = span.maxX - span.minX + 1;
      const ownerOffset = (y * this.canvas.width + span.minX) * 2;
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

      const idOffset = y * this.canvas.width + span.minX;
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

  private uploadSmoothTextures(): { rows: number; bytes: number } {
    if (!this.gl || !this.prevOwnerTexture || !this.changeMaskTexture) {
      return { rows: 0, bytes: 0 };
    }
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    const bytesPerOwner = Uint16Array.BYTES_PER_ELEMENT;
    const bytesPerMask = Uint8Array.BYTES_PER_ELEMENT;
    let rowsUploaded = 0;
    let bytesUploaded = 0;

    if (this.needsSmoothFullUpload) {
      gl.activeTexture(gl.TEXTURE7);
      gl.bindTexture(gl.TEXTURE_2D, this.prevOwnerTexture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R16UI,
        this.canvas.width,
        this.canvas.height,
        0,
        gl.RED_INTEGER,
        gl.UNSIGNED_SHORT,
        this.smoothPrevOwnerState,
      );

      gl.activeTexture(gl.TEXTURE8);
      gl.bindTexture(gl.TEXTURE_2D, this.changeMaskTexture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R8UI,
        this.canvas.width,
        this.canvas.height,
        0,
        gl.RED_INTEGER,
        gl.UNSIGNED_BYTE,
        this.smoothChangeMaskState,
      );

      this.needsSmoothFullUpload = false;
      this.smoothDirtyRows.clear();
      rowsUploaded = this.canvas.height;
      bytesUploaded =
        this.canvas.width * this.canvas.height * (bytesPerOwner + bytesPerMask);
      return { rows: rowsUploaded, bytes: bytesUploaded };
    }

    if (this.smoothDirtyRows.size === 0) {
      return { rows: 0, bytes: 0 };
    }

    for (const [y, span] of this.smoothDirtyRows) {
      const width = span.maxX - span.minX + 1;
      const ownerOffset = y * this.canvas.width + span.minX;
      const ownerSlice = this.smoothPrevOwnerState.subarray(
        ownerOffset,
        ownerOffset + width,
      );

      gl.activeTexture(gl.TEXTURE7);
      gl.bindTexture(gl.TEXTURE_2D, this.prevOwnerTexture);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        span.minX,
        y,
        width,
        1,
        gl.RED_INTEGER,
        gl.UNSIGNED_SHORT,
        ownerSlice,
      );

      const maskOffset = y * this.canvas.width + span.minX;
      const maskSlice = this.smoothChangeMaskState.subarray(
        maskOffset,
        maskOffset + width,
      );
      gl.activeTexture(gl.TEXTURE8);
      gl.bindTexture(gl.TEXTURE_2D, this.changeMaskTexture);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        span.minX,
        y,
        width,
        1,
        gl.RED_INTEGER,
        gl.UNSIGNED_BYTE,
        maskSlice,
      );

      rowsUploaded++;
      bytesUploaded += width * (bytesPerOwner + bytesPerMask);
    }
    this.smoothDirtyRows.clear();
    return { rows: rowsUploaded, bytes: bytesUploaded };
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
      !this.prevOwnerTexture ||
      !this.vao
    ) {
      return;
    }
    if (!this.jfaDirty) {
      return;
    }
    const gl = this.gl;
    const prevBlend = gl.isEnabled(gl.BLEND);
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.bindVertexArray(this.vao);

    gl.useProgram(this.jfaSeedProgram);
    if (this.jfaSeedUniforms.resolution) {
      gl.uniform2f(
        this.jfaSeedUniforms.resolution,
        this.canvas.width,
        this.canvas.height,
      );
    }
    if (this.jfaSeedUniforms.prevOwner) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.prevOwnerTexture);
      gl.uniform1i(this.jfaSeedUniforms.prevOwner, 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.jfaFramebufferA);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    let readTex = this.jfaTextureA;
    let writeFbo = this.jfaFramebufferB;
    let writeTex = this.jfaTextureB;
    for (const step of this.jfaSteps) {
      gl.useProgram(this.jfaProgram);
      if (this.jfaUniforms.resolution) {
        gl.uniform2f(
          this.jfaUniforms.resolution,
          this.canvas.width,
          this.canvas.height,
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
      writeFbo =
        writeFbo === this.jfaFramebufferB
          ? this.jfaFramebufferA
          : this.jfaFramebufferB;
    }

    this.jfaResultIsA = readTex === this.jfaTextureA;
    this.jfaDirty = false;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (prevBlend) {
      gl.enable(gl.BLEND);
    }
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
      precision mediump float;
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

      uniform usampler2D u_prevOwner;
      uniform vec2 u_resolution;

      out vec2 outSeed;

      uint ownerAt(ivec2 texCoord) {
        ivec2 clamped = clamp(
          texCoord,
          ivec2(0, 0),
          ivec2(int(u_resolution.x) - 1, int(u_resolution.y) - 1)
        );
        return texelFetch(u_prevOwner, clamped, 0).r;
      }

      void main() {
        ivec2 fragCoord = ivec2(gl_FragCoord.xy);
        ivec2 texCoord = ivec2(fragCoord.x, int(u_resolution.y) - 1 - fragCoord.y);

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

        outSeed = isBorder ? vec2(texCoord) : vec2(-1.0, -1.0);
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
      precision mediump float;
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
        float dist = length(seed - vec2(texCoord));
        if (dist < bestDist) {
          bestDist = dist;
          bestSeed = seed;
        }
      }

      void main() {
        ivec2 fragCoord = ivec2(gl_FragCoord.xy);
        ivec2 texCoord = ivec2(fragCoord.x, int(u_resolution.y) - 1 - fragCoord.y);
        int step = int(u_step + 0.5);

        vec2 bestSeed = seedAt(texCoord);
        float bestDist = bestSeed.x < 0.0 ? 1e20 : length(bestSeed - vec2(texCoord));

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

  private createProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
    const vertexShaderSource = `#version 300 es
      precision mediump float;
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
      precision mediump float;
      precision highp usampler2D;

      uniform usampler2D u_state;
      uniform sampler2D u_palette;
      uniform usampler2D u_relations;
      uniform usampler2D u_patterns;
      uniform usampler2D u_contestOwners;
      uniform usampler2D u_contestIds;
      uniform usampler2D u_contestTimes;
      uniform int u_contestNow;
      uniform float u_contestDurationMs;
      uniform usampler2D u_prevOwner;
      uniform usampler2D u_changeMask;
      uniform sampler2D u_jfaSeeds;
      uniform float u_smoothProgress;
      uniform float u_smoothMaxDistance;
      uniform bool u_smoothEnabled;
      uniform int u_patternStride;
      uniform int u_patternRows;
      uniform int u_viewerId;
      uniform vec2 u_resolution;
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

      out vec4 outColor;

      uint ownerAtTex(ivec2 texCoord) {
        ivec2 clamped = clamp(
          texCoord,
          ivec2(0, 0),
          ivec2(int(u_resolution.x) - 1, int(u_resolution.y) - 1)
        );
        return texelFetch(u_state, clamped, 0).r & 0xFFFu;
      }

      uint prevOwnerAtTex(ivec2 texCoord) {
        ivec2 clamped = clamp(
          texCoord,
          ivec2(0, 0),
          ivec2(int(u_resolution.x) - 1, int(u_resolution.y) - 1)
        );
        return texelFetch(u_prevOwner, clamped, 0).r & 0xFFFu;
      }

      uint changeMaskAtTex(ivec2 texCoord) {
        ivec2 clamped = clamp(
          texCoord,
          ivec2(0, 0),
          ivec2(int(u_resolution.x) - 1, int(u_resolution.y) - 1)
        );
        return texelFetch(u_changeMask, clamped, 0).r;
      }

      vec2 jfaSeedAtTex(ivec2 texCoord) {
        ivec2 clamped = clamp(
          texCoord,
          ivec2(0, 0),
          ivec2(int(u_resolution.x) - 1, int(u_resolution.y) - 1)
        );
        return texelFetch(u_jfaSeeds, clamped, 0).rg;
      }

      uvec2 contestOwnersAtTex(ivec2 texCoord) {
        ivec2 clamped = clamp(
          texCoord,
          ivec2(0, 0),
          ivec2(int(u_resolution.x) - 1, int(u_resolution.y) - 1)
        );
        return texelFetch(u_contestOwners, clamped, 0).rg;
      }

      uint contestIdRawAtTex(ivec2 texCoord) {
        ivec2 clamped = clamp(
          texCoord,
          ivec2(0, 0),
          ivec2(int(u_resolution.x) - 1, int(u_resolution.y) - 1)
        );
        return texelFetch(u_contestIds, clamped, 0).r;
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
        ivec2 fragCoord = ivec2(gl_FragCoord.xy);
        ivec2 texCoord = ivec2(fragCoord.x, int(u_resolution.y) - 1 - fragCoord.y);

        uint state = texelFetch(u_state, texCoord, 0).r;
        uint owner = state & 0xFFFu;
        bool hasFallout = (state & 0x2000u) != 0u;
        bool isDefended = (state & 0x1000u) != 0u;

        uint contestIdRaw = contestIdRawAtTex(texCoord);
        const uint CONTEST_ID_MASK = 0x7FFFu;
        const uint CONTEST_ATTACKER_EVER = 0x8000u;
        uint contestId = contestIdRaw & CONTEST_ID_MASK;
        bool attackerEver = (contestIdRaw & CONTEST_ATTACKER_EVER) != 0u;
        uvec2 contestOwners = contestOwnersAtTex(texCoord);
        uint defender = contestOwners.r & 0xFFFu;
        uint attacker = contestOwners.g & 0xFFFu;

        bool contested = false;
        if (contestId != 0u) {
          uint lastTime = texelFetch(u_contestTimes, ivec2(int(contestId), 0), 0).r;
          const uint CONTEST_WRAP = 32768u;
          uint nowTime = uint(u_contestNow);
          uint elapsed = nowTime >= lastTime
            ? (nowTime - lastTime)
            : (CONTEST_WRAP - lastTime + nowTime);
          contested = float(elapsed) < u_contestDurationMs;
        }

        bool isBorder = false;
        bool hasFriendlyRelation = false;
        bool hasEmbargoRelation = false;
        bool pushedBorder = false;
        bool regainedBorder = false;

        uint nOwner = ownerAtTex(texCoord + ivec2(1, 0));
        isBorder = isBorder || (nOwner != owner);
        if (nOwner != owner && nOwner != 0u) {
          uint rel = relationCode(owner, nOwner);
          hasEmbargoRelation = hasEmbargoRelation || isEmbargo(rel);
          hasFriendlyRelation = hasFriendlyRelation || isFriendly(rel);
        }
        if (contested) {
          uint nContestRaw = contestIdRawAtTex(texCoord + ivec2(1, 0));
          uint nContestId = nContestRaw & CONTEST_ID_MASK;
          bool sameComponent = nContestId == contestId;
          bool nAttackerEver = sameComponent && ((nContestRaw & CONTEST_ATTACKER_EVER) != 0u);
          if (attackerEver && !nAttackerEver) {
            pushedBorder = true;
          }
          if (sameComponent && owner == defender && nOwner == attacker) {
            regainedBorder = true;
          }
        }

        nOwner = ownerAtTex(texCoord + ivec2(-1, 0));
        isBorder = isBorder || (nOwner != owner);
        if (nOwner != owner && nOwner != 0u) {
          uint rel = relationCode(owner, nOwner);
          hasEmbargoRelation = hasEmbargoRelation || isEmbargo(rel);
          hasFriendlyRelation = hasFriendlyRelation || isFriendly(rel);
        }
        if (contested) {
          uint nContestRaw = contestIdRawAtTex(texCoord + ivec2(-1, 0));
          uint nContestId = nContestRaw & CONTEST_ID_MASK;
          bool sameComponent = nContestId == contestId;
          bool nAttackerEver = sameComponent && ((nContestRaw & CONTEST_ATTACKER_EVER) != 0u);
          if (attackerEver && !nAttackerEver) {
            pushedBorder = true;
          }
          if (sameComponent && owner == defender && nOwner == attacker) {
            regainedBorder = true;
          }
        }

        nOwner = ownerAtTex(texCoord + ivec2(0, 1));
        isBorder = isBorder || (nOwner != owner);
        if (nOwner != owner && nOwner != 0u) {
          uint rel = relationCode(owner, nOwner);
          hasEmbargoRelation = hasEmbargoRelation || isEmbargo(rel);
          hasFriendlyRelation = hasFriendlyRelation || isFriendly(rel);
        }
        if (contested) {
          uint nContestRaw = contestIdRawAtTex(texCoord + ivec2(0, 1));
          uint nContestId = nContestRaw & CONTEST_ID_MASK;
          bool sameComponent = nContestId == contestId;
          bool nAttackerEver = sameComponent && ((nContestRaw & CONTEST_ATTACKER_EVER) != 0u);
          if (attackerEver && !nAttackerEver) {
            pushedBorder = true;
          }
          if (sameComponent && owner == defender && nOwner == attacker) {
            regainedBorder = true;
          }
        }

        nOwner = ownerAtTex(texCoord + ivec2(0, -1));
        isBorder = isBorder || (nOwner != owner);
        if (nOwner != owner && nOwner != 0u) {
          uint rel = relationCode(owner, nOwner);
          hasEmbargoRelation = hasEmbargoRelation || isEmbargo(rel);
          hasFriendlyRelation = hasFriendlyRelation || isFriendly(rel);
        }
        if (contested) {
          uint nContestRaw = contestIdRawAtTex(texCoord + ivec2(0, -1));
          uint nContestId = nContestRaw & CONTEST_ID_MASK;
          bool sameComponent = nContestId == contestId;
          bool nAttackerEver = sameComponent && ((nContestRaw & CONTEST_ATTACKER_EVER) != 0u);
          if (attackerEver && !nAttackerEver) {
            pushedBorder = true;
          }
          if (sameComponent && owner == defender && nOwner == attacker) {
            regainedBorder = true;
          }
        }

        if (u_alternativeView) {
          vec3 color = vec3(0.0);
          float a = 0.0;
          if (owner != 0u) {
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
            a = isBorder ? 1.0 : 0.0;
          }
          if (u_hoveredPlayerId >= 0.0 && abs(float(owner) - u_hoveredPlayerId) < 0.5) {
            float pulse = u_hoverPulseStrength > 0.0
              ? (1.0 - u_hoverPulseStrength) +
                u_hoverPulseStrength * (0.5 + 0.5 * sin(u_time * u_hoverPulseSpeed))
            : 1.0;
            color = mix(color, u_hoverHighlightColor, u_hoverHighlightStrength * pulse);
          }
          outColor = vec4(color * a, a);
          return;
        }

        vec3 fillColor = vec3(0.0);
        float fillAlpha = 0.0;
        vec3 borderColor = vec3(0.0);
        float borderAlpha = 0.0;
        vec3 ownerBase = vec3(0.0);
        vec4 ownerBorder = vec4(0.0);

        if (owner == 0u) {
          if (hasFallout) {
            fillColor = u_fallout.rgb;
            fillAlpha = u_alpha;
          }
        } else {
          vec4 base = texelFetch(u_palette, ivec2(int(owner) * 2, 0), 0);
          vec4 baseBorder = texelFetch(
            u_palette,
            ivec2(int(owner) * 2 + 1, 0),
            0
          );
          ownerBase = base.rgb;
          ownerBorder = baseBorder;
          if (isBorder) {
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
            fillColor = isPrimary ? base.rgb : baseBorder.rgb;
            fillAlpha = u_alpha;
          }
        }

        vec3 contestedFillColor = fillColor;
        float contestedFillAlpha = fillAlpha;
        if (contested && owner != 0u) {
          vec3 defenderBase = ownerBase;
          if (defender != 0u) {
            vec4 defenderColor = texelFetch(
              u_palette,
              ivec2(int(defender) * 2, 0),
              0
            );
            defenderBase = defenderColor.rgb;
          }
          bool isLightTile = ((texCoord.x % 2) == (texCoord.y % 2));
          contestedFillColor = isLightTile ? ownerBase : defenderBase;
          contestedFillAlpha = u_alpha;
        }

        vec3 attackerBorderColor = vec3(0.0);
        float attackerBorderAlpha = 0.0;
        if (attacker != 0u) {
          vec4 attackerBorder = texelFetch(
            u_palette,
            ivec2(int(attacker) * 2 + 1, 0),
            0
          );
          attackerBorderColor = applyDefended(attackerBorder.rgb, isDefended, texCoord);
          attackerBorderAlpha = attackerBorder.a;
        }

        vec3 color = contested ? contestedFillColor : fillColor;
        float a = contested ? contestedFillAlpha : fillAlpha;

        if (isBorder && owner != 0u) {
          color = borderColor;
          a = borderAlpha;
        }

        if (contested) {
          if (regainedBorder) {
            vec3 regained = applyDefended(vec3(1.0, 0.2, 0.2), isDefended, texCoord);
            color = regained;
            a = 1.0;
          } else if (pushedBorder) {
            color = attackerBorderColor;
            a = attackerBorderAlpha;
          } else if (isBorder && owner != 0u) {
            color = borderColor;
            a = borderAlpha;
          } else if (owner != 0u) {
            color = contestedFillColor;
            a = contestedFillAlpha;
          }
        }

        bool smoothActive = u_smoothEnabled &&
          u_smoothProgress < 1.0 &&
          !u_alternativeView &&
          !contested &&
          changeMaskAtTex(texCoord) != 0u;

        if (smoothActive) {
          uint oldOwner = prevOwnerAtTex(texCoord);
          bool oldIsBorder = false;
          bool oldFriendlyRelation = false;
          bool oldEmbargoRelation = false;

          if (oldOwner != 0u) {
            uint prevNeighbor = prevOwnerAtTex(texCoord + ivec2(1, 0));
            oldIsBorder = oldIsBorder || (prevNeighbor != oldOwner);
            if (prevNeighbor != oldOwner && prevNeighbor != 0u) {
              uint rel = relationCode(oldOwner, prevNeighbor);
              oldEmbargoRelation = oldEmbargoRelation || isEmbargo(rel);
              oldFriendlyRelation = oldFriendlyRelation || isFriendly(rel);
            }
            prevNeighbor = prevOwnerAtTex(texCoord + ivec2(-1, 0));
            oldIsBorder = oldIsBorder || (prevNeighbor != oldOwner);
            if (prevNeighbor != oldOwner && prevNeighbor != 0u) {
              uint rel = relationCode(oldOwner, prevNeighbor);
              oldEmbargoRelation = oldEmbargoRelation || isEmbargo(rel);
              oldFriendlyRelation = oldFriendlyRelation || isFriendly(rel);
            }
            prevNeighbor = prevOwnerAtTex(texCoord + ivec2(0, 1));
            oldIsBorder = oldIsBorder || (prevNeighbor != oldOwner);
            if (prevNeighbor != oldOwner && prevNeighbor != 0u) {
              uint rel = relationCode(oldOwner, prevNeighbor);
              oldEmbargoRelation = oldEmbargoRelation || isEmbargo(rel);
              oldFriendlyRelation = oldFriendlyRelation || isFriendly(rel);
            }
            prevNeighbor = prevOwnerAtTex(texCoord + ivec2(0, -1));
            oldIsBorder = oldIsBorder || (prevNeighbor != oldOwner);
            if (prevNeighbor != oldOwner && prevNeighbor != 0u) {
              uint rel = relationCode(oldOwner, prevNeighbor);
              oldEmbargoRelation = oldEmbargoRelation || isEmbargo(rel);
              oldFriendlyRelation = oldFriendlyRelation || isFriendly(rel);
            }
          }

          vec3 oldColor = vec3(0.0);
          float oldAlpha = 0.0;
          if (oldOwner == 0u) {
            if (hasFallout) {
              oldColor = u_fallout.rgb;
              oldAlpha = u_alpha;
            }
          } else {
            vec4 oldBase = texelFetch(u_palette, ivec2(int(oldOwner) * 2, 0), 0);
            vec4 oldBorder = texelFetch(
              u_palette,
              ivec2(int(oldOwner) * 2 + 1, 0),
              0
            );
            if (oldIsBorder) {
              vec3 oldBorderColor = oldBorder.rgb;

              const float BORDER_TINT_RATIO = 0.35;
              const vec3 FRIENDLY_TINT_TARGET = vec3(0.0, 1.0, 0.0);
              const vec3 EMBARGO_TINT_TARGET = vec3(1.0, 0.0, 0.0);

              if (oldFriendlyRelation) {
                oldBorderColor = oldBorderColor * (1.0 - BORDER_TINT_RATIO) +
                                FRIENDLY_TINT_TARGET * BORDER_TINT_RATIO;
              }
              if (oldEmbargoRelation) {
                oldBorderColor = oldBorderColor * (1.0 - BORDER_TINT_RATIO) +
                                EMBARGO_TINT_TARGET * BORDER_TINT_RATIO;
              }

              oldColor = applyDefended(oldBorderColor, isDefended, texCoord);
              oldAlpha = oldBorder.a;
            } else {
              bool oldPrimary = patternIsPrimary(oldOwner, texCoord);
              oldColor = oldPrimary ? oldBase.rgb : oldBorder.rgb;
              oldAlpha = u_alpha;
            }
          }

          vec2 seed = jfaSeedAtTex(texCoord);
          float distance = seed.x < 0.0 ? 1e6 : length(seed - vec2(texCoord));
          float edge = u_smoothProgress * u_smoothMaxDistance;
          float reveal = 1.0 - smoothstep(edge - 0.5, edge + 0.5, distance);
          color = mix(oldColor, color, reveal);
          a = mix(oldAlpha, a, reveal);
        }

        if (u_hoveredPlayerId >= 0.0 && abs(float(owner) - u_hoveredPlayerId) < 0.5) {
          float pulse = u_hoverPulseStrength > 0.0
            ? (1.0 - u_hoverPulseStrength) +
              u_hoverPulseStrength * (0.5 + 0.5 * sin(u_time * u_hoverPulseSpeed))
            : 1.0;
          color = mix(color, u_hoverHighlightColor, u_hoverHighlightStrength * pulse);
        }

        outColor = vec4(color * a, a);
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
