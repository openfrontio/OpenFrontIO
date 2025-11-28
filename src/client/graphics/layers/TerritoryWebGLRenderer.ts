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
 * Borders are still drawn by the dedicated border renderer; this class
 * only fills territory / fallout tiles.
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

  private constructor(
    private readonly game: GameView,
    private readonly theme: Theme,
    sharedState: SharedArrayBuffer,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = game.width();
    this.canvas.height = game.height();

    this.state = new Uint16Array(sharedState);

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

    gl.useProgram(this.program);
    gl.uniform1i(this.uniforms.state, 0);
    gl.uniform1i(this.uniforms.palette, 1);
    gl.uniform1i(this.uniforms.relations, 2);

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
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
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

    const uploadSpan = FrameProfiler.start();
    this.uploadStateTexture();
    FrameProfiler.end("TerritoryWebGLRenderer:uploadState", uploadSpan);

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

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    FrameProfiler.end("TerritoryWebGLRenderer:draw", renderSpan);
  }

  private uploadStateTexture() {
    if (!this.gl || !this.stateTexture) return;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.stateTexture);

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
      return;
    }

    if (this.dirtyRows.size === 0) {
      return;
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
    }
    this.dirtyRows.clear();
  }

  private uploadPalette() {
    if (!this.gl || !this.paletteTexture || !this.relationTexture) return;
    const gl = this.gl;
    const players = this.game.playerViews().filter((p) => p.isPlayer());
    const myPlayer = this.game.myPlayer();

    const maxId = players.reduce((max, p) => Math.max(max, p.smallID()), 0) + 1;
    this.paletteWidth = Math.max(maxId, 1);

    const paletteData = new Uint8Array(this.paletteWidth * 4);
    const relationData = new Uint8Array(this.paletteWidth);

    for (const p of players) {
      const id = p.smallID();
      const rgba = p.territoryColor().rgba;
      paletteData[id * 4] = rgba.r;
      paletteData[id * 4 + 1] = rgba.g;
      paletteData[id * 4 + 2] = rgba.b;
      paletteData[id * 4 + 3] = Math.round((rgba.a ?? 1) * 255);

      relationData[id] = this.resolveRelationCode(p, myPlayer);
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
      this.paletteWidth,
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
      1,
      0,
      gl.RED_INTEGER,
      gl.UNSIGNED_BYTE,
      relationData,
    );
  }

  private resolveRelationCode(
    owner: PlayerView,
    myPlayer: PlayerView | null,
  ): number {
    if (!myPlayer) {
      return 3; // Neutral
    }
    if (owner.smallID() === myPlayer.smallID()) {
      return 1; // Self
    }
    if (owner.isFriendly(myPlayer)) {
      return 2; // Ally
    }
    if (!owner.hasEmbargo(myPlayer)) {
      return 3; // Neutral
    }
    return 4; // Enemy
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

      void main() {
        ivec2 fragCoord = ivec2(gl_FragCoord.xy);
        // gl_FragCoord origin is bottom-left; flip Y to match top-left oriented buffers.
        ivec2 texCoord = ivec2(fragCoord.x, int(u_resolution.y) - 1 - fragCoord.y);

        uint state = texelFetch(u_state, texCoord, 0).r;
        uint owner = state & 0xFFFu;
        bool hasFallout = (state & 0x2000u) != 0u; // bit 13

        if (owner == 0u) {
          if (hasFallout) {
            outColor = vec4(u_fallout.rgb, u_alpha);
          } else {
            outColor = vec4(0.0);
          }
          return;
        }

        // Border detection via neighbor comparison
        bool isBorder = false;
        uint nOwner = ownerAtTex(texCoord + ivec2(1, 0));
        isBorder = isBorder || (nOwner != owner);
        nOwner = ownerAtTex(texCoord + ivec2(-1, 0));
        isBorder = isBorder || (nOwner != owner);
        nOwner = ownerAtTex(texCoord + ivec2(0, 1));
        isBorder = isBorder || (nOwner != owner);
        nOwner = ownerAtTex(texCoord + ivec2(0, -1));
        isBorder = isBorder || (nOwner != owner);

        if (u_alternativeView) {
          uint relation = texelFetch(u_relations, ivec2(int(owner), 0), 0).r;
          vec4 altColor = u_altNeutral;
          if (relation == 1u) {
            altColor = u_altSelf;
          } else if (relation == 2u) {
            altColor = u_altAlly;
          } else if (relation >= 4u) {
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
          outColor = vec4(color, a);
          return;
        }

        vec4 base = texelFetch(u_palette, ivec2(int(owner), 0), 0);
        float a = isBorder ? 1.0 : u_alpha;
        vec3 color = base.rgb;

        if (u_hoveredPlayerId >= 0.0 && abs(float(owner) - u_hoveredPlayerId) < 0.5) {
          float pulse = u_hoverPulseStrength > 0.0
            ? (1.0 - u_hoverPulseStrength) +
              u_hoverPulseStrength * (0.5 + 0.5 * sin(u_time * u_hoverPulseSpeed))
            : 1.0;
          color = mix(color, u_hoverHighlightColor, u_hoverHighlightStrength * pulse);
        }

        outColor = vec4(color, a);
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
