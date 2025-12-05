import { Theme } from "../../../core/configuration/Config";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, PlayerView } from "../../../core/game/GameView";
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

/**
 * WebGL2 territory renderer that reads the shared tile state buffer
 * (SharedArrayBuffer) and shades tiles via a small palette texture.
 * Handles both territory/fallout fills and border rendering in a unified shader.
 */
export class TerritoryWebGLRenderer {
  public readonly canvas: HTMLCanvasElement;

  private readonly gl: WebGL2RenderingContext | null;
  private readonly program: WebGLProgram | null;
  private readonly vao: WebGLVertexArrayObject | null;
  private readonly vertexBuffer: WebGLBuffer | null;
  private readonly stateTexture: WebGLTexture | null;
  private readonly paletteTexture: WebGLTexture | null;
  private readonly relationTexture: WebGLTexture | null;
  private readonly uniforms: {
    resolution: WebGLUniformLocation | null;
    state: WebGLUniformLocation | null;
    palette: WebGLUniformLocation | null;
    relations: WebGLUniformLocation | null;
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
    // Border color uniforms for shader-computed borders
    borderNeutral: WebGLUniformLocation | null;
    borderFriendly: WebGLUniformLocation | null;
    borderEmbargo: WebGLUniformLocation | null;
    borderDefendedNeutralLight: WebGLUniformLocation | null;
    borderDefendedNeutralDark: WebGLUniformLocation | null;
    borderDefendedFriendlyLight: WebGLUniformLocation | null;
    borderDefendedFriendlyDark: WebGLUniformLocation | null;
    borderDefendedEmbargoLight: WebGLUniformLocation | null;
    borderDefendedEmbargoDark: WebGLUniformLocation | null;
    // Tick intrapolation uniforms
    prevState: WebGLUniformLocation | null;
    arrivalPhase: WebGLUniformLocation | null;
    tickProgress: WebGLUniformLocation | null;
    tickParity: WebGLUniformLocation | null;
  };

  private readonly state: Uint16Array;
  private readonly dirtyRows: Map<number, DirtySpan> = new Map();
  private needsFullUpload = true;
  private alternativeView = false;
  private paletteWidth = 0;
  private hoverHighlightStrength = 0.7;
  private hoverHighlightColor: [number, number, number] = [1, 1, 1];
  private hoverPulseStrength = 0.25;
  private hoverPulseSpeed = Math.PI * 2;
  private hoveredPlayerId = -1;
  private animationStartTime = Date.now();

  // Tick intrapolation buffers (client-side only, WebGL path).
  private readonly prevState: Uint16Array;
  private readonly arrivalPhase: Uint8Array;
  private readonly changeParity: Uint8Array;

  // Packed texel buffer backing the arrivalPhase texture (RG8: phase, parity).
  private readonly arrivalPhaseTexData: Uint8Array;

  // Corresponding textures.
  private readonly arrivalPhaseTexture: WebGLTexture | null = null;

  // Tick timing for shader.
  private lastTickId = 0;
  private lastTickStartMs = 0;
  private tickDurationMs = 100;
  private tickParity = 0;

  private constructor(
    private readonly game: GameView,
    private readonly theme: Theme,
    sharedState: SharedArrayBuffer,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = game.width();
    this.canvas.height = game.height();

    this.state = new Uint16Array(sharedState);
    // Allocate intrapolation buffers.
    const numTiles = this.canvas.width * this.canvas.height;
    this.prevState = new Uint16Array(numTiles);
    this.arrivalPhase = new Uint8Array(numTiles);
    this.changeParity = new Uint8Array(numTiles);
    this.arrivalPhaseTexData = new Uint8Array(numTiles * 2);

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
      this.uniforms = {
        resolution: null,
        state: null,
        palette: null,
        relations: null,
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
        borderNeutral: null,
        borderFriendly: null,
        borderEmbargo: null,
        borderDefendedNeutralLight: null,
        borderDefendedNeutralDark: null,
        borderDefendedFriendlyLight: null,
        borderDefendedFriendlyDark: null,
        borderDefendedEmbargoLight: null,
        borderDefendedEmbargoDark: null,
        prevState: null,
        arrivalPhase: null,
        tickProgress: null,
        tickParity: null,
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
      this.uniforms = {
        resolution: null,
        state: null,
        palette: null,
        relations: null,
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
        borderNeutral: null,
        borderFriendly: null,
        borderEmbargo: null,
        borderDefendedNeutralLight: null,
        borderDefendedNeutralDark: null,
        borderDefendedFriendlyLight: null,
        borderDefendedFriendlyDark: null,
        borderDefendedEmbargoLight: null,
        borderDefendedEmbargoDark: null,
        prevState: null,
        arrivalPhase: null,
        tickProgress: null,
        tickParity: null,
      };
      return;
    }

    this.uniforms = {
      resolution: gl.getUniformLocation(this.program, "u_resolution"),
      state: gl.getUniformLocation(this.program, "u_state"),
      palette: gl.getUniformLocation(this.program, "u_palette"),
      relations: gl.getUniformLocation(this.program, "u_relations"),
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
      borderNeutral: gl.getUniformLocation(this.program, "u_borderNeutral"),
      borderFriendly: gl.getUniformLocation(this.program, "u_borderFriendly"),
      borderEmbargo: gl.getUniformLocation(this.program, "u_borderEmbargo"),
      borderDefendedNeutralLight: gl.getUniformLocation(
        this.program,
        "u_borderDefendedNeutralLight",
      ),
      borderDefendedNeutralDark: gl.getUniformLocation(
        this.program,
        "u_borderDefendedNeutralDark",
      ),
      borderDefendedFriendlyLight: gl.getUniformLocation(
        this.program,
        "u_borderDefendedFriendlyLight",
      ),
      borderDefendedFriendlyDark: gl.getUniformLocation(
        this.program,
        "u_borderDefendedFriendlyDark",
      ),
      borderDefendedEmbargoLight: gl.getUniformLocation(
        this.program,
        "u_borderDefendedEmbargoLight",
      ),
      borderDefendedEmbargoDark: gl.getUniformLocation(
        this.program,
        "u_borderDefendedEmbargoDark",
      ),
      prevState: null,
      arrivalPhase: gl.getUniformLocation(this.program, "u_arrivalPhase"),
      tickProgress: gl.getUniformLocation(this.program, "u_tickProgress"),
      tickParity: gl.getUniformLocation(this.program, "u_tickParity"),
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

    // Initialize intrapolation buffers from current game state.
    this.initPrevStateFromGame();

    // Create texture for arrivalPhase.
    const arrivalTex = gl.createTexture();
    this.arrivalPhaseTexture = arrivalTex;

    // State texture (current map state from SAB).
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

    // Arrival phase texture (use RG8, R=phase, G=parity flag).
    if (this.arrivalPhaseTexture) {
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, this.arrivalPhaseTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RG8,
        this.canvas.width,
        this.canvas.height,
        0,
        gl.RG,
        gl.UNSIGNED_BYTE,
        this.arrivalPhaseTexData,
      );
    }

    this.uploadPalette();

    gl.useProgram(this.program);
    gl.uniform1i(this.uniforms.state, 0);
    gl.uniform1i(this.uniforms.palette, 1);
    gl.uniform1i(this.uniforms.relations, 2);
    if (this.uniforms.arrivalPhase) {
      gl.uniform1i(this.uniforms.arrivalPhase, 4);
    }

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

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  static create(game: GameView, theme: Theme): TerritoryWebGLCreateResult {
    const sharedState = game.sharedStateBuffer();
    if (!sharedState) {
      return {
        renderer: null,
        reason:
          "Shared tile state not available. WebGL territory renderer needs SharedArrayBuffer.",
      };
    }

    const expected = game.width() * game.height();
    if (new Uint16Array(sharedState).length !== expected) {
      return {
        renderer: null,
        reason:
          "Shared tile buffer size mismatch; falling back to canvas territory draw.",
      };
    }

    const renderer = new TerritoryWebGLRenderer(game, theme, sharedState);
    if (!renderer.isValid()) {
      return {
        renderer: null,
        reason: "WebGL2 not available; falling back to canvas territory draw.",
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

  /**
   * Initialize prevState buffer from the current GameView map state.
   * Only called once during construction.
   */
  private initPrevStateFromGame() {
    const numTiles = this.canvas.width * this.canvas.height;
    for (let tile = 0; tile < numTiles; tile++) {
      const ownerId = this.game.ownerID(tile as TileRef);
      const hasFallout = this.game.hasFallout(tile as TileRef);
      const isDefended = this.game.isDefended(tile as TileRef);
      let state = ownerId & 0x0fff;
      if (isDefended) {
        state |= 1 << 12;
      }
      if (hasFallout) {
        state |= 1 << 13;
      }
      this.prevState[tile] = state;
      this.arrivalPhase[tile] = 0xff;
      this.changeParity[tile] = 0;
      const idx = tile * 2;
      this.arrivalPhaseTexData[idx] = this.arrivalPhase[tile];
      this.arrivalPhaseTexData[idx + 1] = this.changeParity[tile];
    }
  }

  /**
   * Update arrival phase and parity for tiles that changed this tick.
   * prevState is used as "old" state for animated tiles and is not
   * overwritten here for those tiles.
   */
  updateArrivalForChangedTiles(
    game: GameView,
    tiles: TileRef[],
    tickParity: number,
  ) {
    const maxRadius = 8;
    const width = this.canvas.width;
    const height = this.canvas.height;

    for (const tile of tiles) {
      const prevStateWord = this.prevState[tile];
      const prevOwner = prevStateWord & 0x0fff;
      const newStateWord = this.state[tile];
      const newOwner = newStateWord & 0x0fff;

      // Only animate owner changes for now.
      if (prevOwner === newOwner) {
        // Keep prevState in sync so future owner-change detection is correct.
        this.prevState[tile] = newStateWord;
        continue;
      }

      const x0 = game.x(tile);
      const y0 = game.y(tile);
      let minDistSq = Number.POSITIVE_INFINITY;

      for (let dy = -maxRadius; dy <= maxRadius; dy++) {
        const y = y0 + dy;
        if (y < 0 || y >= height) continue;
        for (let dx = -maxRadius; dx <= maxRadius; dx++) {
          const x = x0 + dx;
          if (x < 0 || x >= width) continue;
          const distSq = dx * dx + dy * dy;
          if (distSq > maxRadius * maxRadius) continue;
          const t2 = game.ref(x, y);
          const prevOwnerHere = this.prevState[t2] & 0x0fff;
          if (prevOwnerHere === newOwner && distSq < minDistSq) {
            minDistSq = distSq;
            if (minDistSq <= 1) break;
          }
        }
        if (minDistSq <= 1) break;
      }

      let phaseByte = 0xff;
      if (minDistSq !== Number.POSITIVE_INFINITY) {
        const dist = Math.sqrt(minDistSq);
        const clipped = Math.min(dist, maxRadius);
        const phase = maxRadius > 0 ? clipped / maxRadius : 1.0;
        phaseByte = Math.max(0, Math.min(255, Math.round(phase * 255)));
      }

      this.arrivalPhase[tile] = phaseByte;
      // Store parity as 0 or 255 so the sampler2D normalized channel is easy to threshold.
      this.changeParity[tile] = tickParity ? 255 : 0;

      const idx = tile * 2;
      this.arrivalPhaseTexData[idx] = this.arrivalPhase[tile];
      this.arrivalPhaseTexData[idx + 1] = this.changeParity[tile];

      // Update the previous-state snapshot to reflect the newly applied state,
      // so subsequent ticks treat this owner as the "old" owner.
      this.prevState[tile] = newStateWord;
    }

    // Mark all potentially affected rows dirty so the textures will be updated.
    for (const tile of tiles) {
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
  }

  setTickTiming(
    tick: number,
    startMs: number,
    durationMs: number,
    parity: number,
  ) {
    this.lastTickId = tick;
    this.lastTickStartMs = startMs;
    this.tickDurationMs = durationMs;
    this.tickParity = parity;
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

  markAllDirty() {
    this.needsFullUpload = true;
    this.dirtyRows.clear();
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
    if (this.uniforms.tickProgress) {
      const now = performance.now();
      const dt = Math.max(0, now - this.lastTickStartMs);
      const progress =
        this.tickDurationMs > 0
          ? Math.max(0, Math.min(1, dt / this.tickDurationMs))
          : 1;
      gl.uniform1f(this.uniforms.tickProgress, progress);
    }
    if (this.uniforms.tickParity) {
      gl.uniform1i(this.uniforms.tickParity, this.tickParity);
    }
    if (this.uniforms.time) {
      const currentTime = (Date.now() - this.animationStartTime) / 1000.0;
      gl.uniform1f(this.uniforms.time, currentTime);
    }
    if (this.uniforms.viewerId) {
      const viewerId = this.game.myPlayer()?.smallID() ?? 0;
      gl.uniform1i(this.uniforms.viewerId, viewerId);
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
      // Full upload: also refresh arrivalPhase texture.
      this.uploadArrivalPhaseTexture(true);
      return { rows: rowsUploaded, bytes: bytesUploaded };
    }

    if (this.dirtyRows.size === 0) {
      // No state changes; still keep prev/arrival textures as-is.
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

    // Apply same row set to arrivalPhase.
    this.uploadArrivalPhaseTexture(false);

    this.dirtyRows.clear();
    return { rows: rowsUploaded, bytes: bytesUploaded };
  }

  private uploadArrivalPhaseTexture(full: boolean) {
    if (!this.gl || !this.arrivalPhaseTexture) return;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.arrivalPhaseTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    if (full) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RG8,
        this.canvas.width,
        this.canvas.height,
        0,
        gl.RG,
        gl.UNSIGNED_BYTE,
        this.arrivalPhaseTexData,
      );
      return;
    }

    if (this.dirtyRows.size === 0) return;

    for (const [y, span] of this.dirtyRows) {
      const width = span.maxX - span.minX + 1;
      const startPixel = y * this.canvas.width + span.minX;
      const startByte = startPixel * 2;
      const endByte = (startPixel + width) * 2;
      const rowSlice = this.arrivalPhaseTexData.subarray(startByte, endByte);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        span.minX,
        y,
        width,
        1,
        gl.RG,
        gl.UNSIGNED_BYTE,
        rowSlice,
      );
    }
  }

  /**
   * Formats upload metrics into a human-readable string for logging/debugging.
   * Used for performance monitoring of WebGL texture uploads, bucketing values
   * to provide meaningful categories rather than exact numbers.
   * currently unused.
   */
  private labelUpload(
    base: string,
    metrics: { rows: number; bytes: number },
  ): string {
    if (metrics.rows === 0 || metrics.bytes === 0) {
      return `${base} (skip)`;
    }
    const rowBucket =
      metrics.rows >= this.canvas.height
        ? "full"
        : `${Math.ceil(metrics.rows / 50) * 50}`;
    const kb = Math.max(1, Math.round(metrics.bytes / 1024));
    const kbBucket = kb > 1024 ? `${Math.round(kb / 1024)}MB` : `${kb}KB`;
    return `${base} rows:${rowBucket} bytes:${kbBucket}`;
  }

  private uploadPalette() {
    if (!this.gl || !this.paletteTexture || !this.relationTexture) return;
    const gl = this.gl;
    const players = this.game.playerViews().filter((p) => p.isPlayer());

    const maxId = players.reduce((max, p) => Math.max(max, p.smallID()), 0) + 1;
    this.paletteWidth = Math.max(maxId, 1);

    const paletteData = new Uint8Array(this.paletteWidth * 8); // 8 bytes per player: territory RGBA + border RGBA
    const relationData = new Uint8Array(this.paletteWidth * this.paletteWidth);

    for (const p of players) {
      const id = p.smallID();
      // Territory color (first 4 bytes)
      const territoryRgba = p.territoryColor().rgba;
      paletteData[id * 8] = territoryRgba.r;
      paletteData[id * 8 + 1] = territoryRgba.g;
      paletteData[id * 8 + 2] = territoryRgba.b;
      paletteData[id * 8 + 3] = Math.round((territoryRgba.a ?? 1) * 255);

      // Base border color (next 4 bytes)
      const borderRgba = p.borderColor().rgba; // Get base border color without relation/defended
      paletteData[id * 8 + 4] = borderRgba.r;
      paletteData[id * 8 + 5] = borderRgba.g;
      paletteData[id * 8 + 6] = borderRgba.b;
      paletteData[id * 8 + 7] = Math.round((borderRgba.a ?? 1) * 255);
    }

    // Build relation matrix: friendly/embargo/self flags per owner/other pair.
    for (let ownerId = 0; ownerId < this.paletteWidth; ownerId++) {
      const owner = this.safePlayerBySmallId(ownerId);
      for (let otherId = 0; otherId < this.paletteWidth; otherId++) {
        const other = this.safePlayerBySmallId(otherId);
        relationData[ownerId * this.paletteWidth + otherId] =
          this.resolveRelationCode(owner, other);
      }
    }

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
      this.paletteWidth * 2, // 2 pixels per player (territory + border)
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
  }

  private resolveRelationCode(
    owner: PlayerView | null,
    other: PlayerView | null,
  ): number {
    if (!owner || !other || !owner.isPlayer() || !other.isPlayer()) {
      return 0; // Neutral / no relation
    }

    let code = 0;
    if (owner.smallID() === other.smallID()) {
      code |= 4; // self bit
    }
    // Friendly if either side is friendly toward the other.
    if (owner.isFriendly(other) || other.isFriendly(owner)) {
      code |= 1;
    }
    // Embargo if owner has embargo against other.
    if (owner.hasEmbargo(other)) {
      code |= 2;
    }
    return code;
  }

  private safePlayerBySmallId(id: number): PlayerView | null {
    const player = this.game.playerBySmallID(id);
    return player instanceof PlayerView ? player : null;
  }

  private createProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
    const vertexShaderSource = `#version 300 es
      precision mediump float;
      in vec2 a_position;
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
        uniform int u_viewerId;
        uniform vec2 u_resolution;
        uniform vec4 u_fallout;
        uniform vec4 u_altSelf;
        uniform vec4 u_altAlly;
        uniform vec4 u_altNeutral;
        uniform vec4 u_altEnemy;
        uniform float u_alpha;
        uniform vec4 u_borderNeutral;
        uniform vec4 u_borderFriendly;
        uniform vec4 u_borderEmbargo;
        uniform vec4 u_borderDefendedNeutralLight;
        uniform vec4 u_borderDefendedNeutralDark;
        uniform vec4 u_borderDefendedFriendlyLight;
        uniform vec4 u_borderDefendedFriendlyDark;
        uniform vec4 u_borderDefendedEmbargoLight;
        uniform vec4 u_borderDefendedEmbargoDark;
        uniform bool u_alternativeView;
        uniform float u_hoveredPlayerId;
        uniform vec3 u_hoverHighlightColor;
        uniform float u_hoverHighlightStrength;
        uniform float u_hoverPulseStrength;
        uniform float u_hoverPulseSpeed;
        uniform float u_time;
        uniform sampler2D u_arrivalPhase;
        uniform float u_tickProgress;
        uniform int u_tickParity;

      out vec4 outColor;

      uint ownerAtTex(ivec2 texCoord) {
        ivec2 clamped = clamp(
          texCoord,
          ivec2(0, 0),
          ivec2(int(u_resolution.x) - 1, int(u_resolution.y) - 1)
        );
        return texelFetch(u_state, clamped, 0).r & 0xFFFu;
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

        void main() {
          ivec2 fragCoord = ivec2(gl_FragCoord.xy);
          // gl_FragCoord origin is bottom-left; flip Y to match top-left oriented buffers.
          ivec2 texCoord = ivec2(fragCoord.x, int(u_resolution.y) - 1 - fragCoord.y);

          uint state = texelFetch(u_state, texCoord, 0).r;
          uint owner = state & 0xFFFu;
          bool hasFallout = (state & 0x2000u) != 0u; // bit 13
          bool isDefended = (state & 0x1000u) != 0u; // bit 12

          vec4 arrival = texture(u_arrivalPhase, (vec2(texCoord) + 0.5) / u_resolution);
          float arrivalPhase = arrival.r;
          int changeParity = arrival.g > 0.5 ? 1 : 0;

          if (owner == 0u) {
            if (hasFallout) {
              vec3 color = u_fallout.rgb;
              float a = u_alpha;
              outColor = vec4(color * a, a);
            } else {
              outColor = vec4(0.0);
            }
            return;
          }

          // Border detection via neighbor comparison and relation checks
          bool isBorder = false;
          bool hasFriendlyRelation = false;
          bool hasEmbargoRelation = false;
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

          if (u_alternativeView) {
            uint relationAlt = relationCode(owner, uint(u_viewerId));
            vec4 altColor = u_altNeutral;
            if (isSelf(relationAlt)) {
              altColor = u_altSelf;
            } else if (isFriendly(relationAlt)) {
              altColor = u_altAlly;
            } else if (isEmbargo(relationAlt)) {
              altColor = u_altEnemy;
            }
            float a = isBorder ? 1.0 : 0.0;
            vec3 color = altColor.rgb;
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

          // Current owner color
          vec4 base = texelFetch(u_palette, ivec2(int(owner) * 2, 0), 0); // territory color
          vec4 baseBorder = texelFetch(u_palette, ivec2(int(owner) * 2 + 1, 0), 0); // base border color
          vec3 color = base.rgb;
          float a = u_alpha;

          if (isBorder) {
            // Start with base border color and apply relation tint
            vec3 borderColor = baseBorder.rgb;

            // Apply relation-based tinting (same logic as PlayerView.borderColor)
            const float BORDER_TINT_RATIO = 0.35;
            const vec3 FRIENDLY_TINT_TARGET = vec3(0.0, 1.0, 0.0); // green
            const vec3 EMBARGO_TINT_TARGET = vec3(1.0, 0.0, 0.0);   // red

            if (hasFriendlyRelation) { // friendly
              borderColor = borderColor * (1.0 - BORDER_TINT_RATIO) +
                            FRIENDLY_TINT_TARGET * BORDER_TINT_RATIO;
            }
            if (hasEmbargoRelation) { // embargo
              borderColor = borderColor * (1.0 - BORDER_TINT_RATIO) +
                            EMBARGO_TINT_TARGET * BORDER_TINT_RATIO;
            }

            // Apply defended checkerboard pattern
            if (isDefended) {
              bool isLightTile = ((texCoord.x % 2) == (texCoord.y % 2));
              const float LIGHT_FACTOR = 1.2;
              const float DARK_FACTOR = 0.8;
              borderColor *= isLightTile ? LIGHT_FACTOR : DARK_FACTOR;
            }

            color = borderColor;
            a = baseBorder.a; // Already in 0-1 range from RGBA8 texture
          }

          if (u_hoveredPlayerId >= 0.0 && abs(float(owner) - u_hoveredPlayerId) < 0.5) {
            float pulse = u_hoverPulseStrength > 0.0
              ? (1.0 - u_hoverPulseStrength) +
                u_hoverPulseStrength * (0.5 + 0.5 * sin(u_time * u_hoverPulseSpeed))
              : 1.0;
            color = mix(color, u_hoverHighlightColor, u_hoverHighlightStrength * pulse);
          }

          vec4 currColor = vec4(color * a, a);

          // Simple arrival-based gating: tiles that changed this tick
          // remain invisible until their local arrivalPhase is reached.
          bool tileChangedThisTick = (changeParity == u_tickParity) && (arrivalPhase < 1.0);
          if (tileChangedThisTick && u_tickProgress < arrivalPhase) {
            outColor = vec4(0.0);
            return;
          }

          outColor = currColor;
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
