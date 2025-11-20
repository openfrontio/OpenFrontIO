import { Colord } from "colord";
import { Theme } from "../../../core/configuration/Config";
import { FrameProfiler } from "../FrameProfiler";

export enum TileRelation {
  Unknown = 0,
  Self = 1,
  Friendly = 2,
  Neutral = 3,
  Enemy = 4,
}

export interface BorderEdge {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  color: Colord;
  ownerSmallId: number;
  relation: TileRelation;
  flags: number;
}

interface UniformLocations {
  alternativeView: WebGLUniformLocation | null;
  hoveredPlayerId: WebGLUniformLocation | null;
  highlightStrength: WebGLUniformLocation | null;
  highlightColor: WebGLUniformLocation | null;
  hoverPulseStrength: WebGLUniformLocation | null;
  hoverPulseSpeed: WebGLUniformLocation | null;
  resolution: WebGLUniformLocation | null;
  themeSelf: WebGLUniformLocation | null;
  themeFriendly: WebGLUniformLocation | null;
  themeNeutral: WebGLUniformLocation | null;
  themeEnemy: WebGLUniformLocation | null;
  time: WebGLUniformLocation | null;
  debugPulse: WebGLUniformLocation | null;
  hoverPulse: WebGLUniformLocation | null;
}

export interface HoverHighlightOptions {
  color?: Colord;
  strength?: number;
  pulseStrength?: number;
  pulseSpeed?: number;
}

export class TerritoryBorderWebGL {
  private static readonly INITIAL_CHUNK_CAPACITY = 65536; // 256;
  private static readonly MAX_EDGES_PER_TILE = 4;
  private static readonly VERTICES_PER_EDGE = 2;
  private static readonly MAX_VERTICES_PER_TILE =
    TerritoryBorderWebGL.MAX_EDGES_PER_TILE *
    TerritoryBorderWebGL.VERTICES_PER_EDGE;
  private static readonly FLOATS_PER_VERTEX = 9;
  private static readonly FLOATS_PER_TILE =
    TerritoryBorderWebGL.MAX_VERTICES_PER_TILE *
    TerritoryBorderWebGL.FLOATS_PER_VERTEX;
  private static readonly STRIDE_BYTES =
    TerritoryBorderWebGL.FLOATS_PER_VERTEX * 4;

  static create(
    width: number,
    height: number,
    theme: Theme,
  ): TerritoryBorderWebGL | null {
    const span = FrameProfiler.start();
    const renderer = new TerritoryBorderWebGL(width, height, theme);
    const result = renderer.isValid() ? renderer : null;
    FrameProfiler.end("TerritoryBorderWebGL:create", span);
    return result;
  }

  public readonly canvas: HTMLCanvasElement;

  private readonly gl: WebGLRenderingContext | null;
  private readonly program: WebGLProgram | null;
  private readonly vertexBuffer: WebGLBuffer | null;
  private vertexData: Float32Array;
  private capacityChunks = TerritoryBorderWebGL.INITIAL_CHUNK_CAPACITY;
  private usedChunks = 0;
  private vertexCount = 0;

  private readonly tileToChunk = new Map<number, number>();
  private readonly chunkToTile: number[] = [];
  private readonly dirtyChunks: Set<number> = new Set();
  private readonly uniforms: UniformLocations;

  private hoveredPlayerId = -1;
  private alternativeView = false;
  private needsRedraw = true;
  private animationStartTime = Date.now();
  private debugPulseEnabled = false;
  private hoverPulseEnabled = false;
  private hoverHighlightStrength = 0.7;
  private hoverHighlightColor: [number, number, number] = [1, 1, 1];
  private hoverPulseStrength = 0.25;
  private hoverPulseSpeed = 6.28318;

  private constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly theme: Theme,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;

    this.gl =
      (this.canvas.getContext("webgl", {
        premultipliedAlpha: true,
        antialias: false,
        preserveDrawingBuffer: true,
      }) as WebGLRenderingContext | null) ??
      (this.canvas.getContext("experimental-webgl", {
        premultipliedAlpha: true,
        antialias: false,
        preserveDrawingBuffer: true,
      }) as WebGLRenderingContext | null);

    this.vertexData = new Float32Array(
      TerritoryBorderWebGL.INITIAL_CHUNK_CAPACITY *
        TerritoryBorderWebGL.FLOATS_PER_TILE,
    );
    // Debug: log initial capacity so we can tune INITIAL_CHUNK_CAPACITY.
    // This will show up once per renderer creation.

    console.log(
      "[TerritoryBorderWebGL] initial capacityChunks=",
      this.capacityChunks,
      "for map size",
      `${this.width}x${this.height}`,
    );

    if (!this.gl) {
      this.program = null;
      this.vertexBuffer = null;
      this.uniforms = {
        alternativeView: null,
        hoveredPlayerId: null,
        highlightStrength: null,
        highlightColor: null,
        hoverPulseStrength: null,
        hoverPulseSpeed: null,
        resolution: null,
        themeSelf: null,
        themeFriendly: null,
        themeNeutral: null,
        themeEnemy: null,
        time: null,
        debugPulse: null,
        hoverPulse: null,
      };
      return;
    }

    const gl = this.gl;
    const vertexShaderSource = `
      precision mediump float;
      attribute vec2 a_position;
      attribute vec4 a_color;
      attribute float a_owner;
      attribute float a_relation;
      attribute float a_flags;

      uniform vec2 u_resolution;

      varying vec4 v_color;
      varying float v_owner;
      varying float v_relation;
      varying float v_flags;

      void main() {
        vec2 zeroToOne = a_position / u_resolution;
        vec2 clipSpace = zeroToOne * 2.0 - 1.0;
        clipSpace.y = -clipSpace.y;
        gl_Position = vec4(clipSpace, 0.0, 1.0);
        v_color = a_color;
        v_owner = a_owner;
        v_relation = a_relation;
        v_flags = a_flags;
      }
    `;
    const fragmentShaderSource = `
      precision mediump float;

      uniform bool u_alternativeView;
      uniform float u_hoveredPlayerId;
      uniform float u_highlightStrength;
      uniform vec3 u_highlightColor;
      uniform float u_hoverPulseStrength;
      uniform float u_hoverPulseSpeed;
      uniform vec4 u_themeSelf;
      uniform vec4 u_themeFriendly;
      uniform vec4 u_themeNeutral;
      uniform vec4 u_themeEnemy;
      uniform float u_time;
      uniform bool u_debugPulse;
      uniform bool u_hoverPulse;

      varying vec4 v_color;
      varying float v_owner;
      varying float v_relation;
      varying float v_flags;

      vec4 relationColor(float relation) {
        if (relation < 0.5) {
          return u_themeNeutral;
        } else if (relation < 1.5) {
          return u_themeSelf;
        } else if (relation < 2.5) {
          return u_themeFriendly;
        } else if (relation < 3.5) {
          return u_themeNeutral;
        }
        return u_themeEnemy;
      }

      vec3 rgbToHsl(vec3 c) {
        float maxc = max(c.r, max(c.g, c.b));
        float minc = min(c.r, min(c.g, c.b));
        float h = 0.0;
        float s = 0.0;
        float l = (maxc + minc) * 0.5;
        if (maxc != minc) {
          float d = maxc - minc;
          s = l > 0.5 ? d / (2.0 - maxc - minc) : d / (maxc + minc);
          if (maxc == c.r) {
            h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
          } else if (maxc == c.g) {
            h = (c.b - c.r) / d + 2.0;
          } else {
            h = (c.r - c.g) / d + 4.0;
          }
          h /= 6.0;
        }
        return vec3(h, s, l);
      }

      float hueToRgb(float p, float q, float t) {
        if (t < 0.0) t += 1.0;
        if (t > 1.0) t -= 1.0;
        if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
        if (t < 1.0/2.0) return q;
        if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
        return p;
      }

      vec3 hslToRgb(vec3 hsl) {
        float h = hsl.x;
        float s = hsl.y;
        float l = hsl.z;
        float r;
        float g;
        float b;
        if (s == 0.0) {
          r = g = b = l;
        } else {
          float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
          float p = 2.0 * l - q;
          r = hueToRgb(p, q, h + 1.0/3.0);
          g = hueToRgb(p, q, h);
          b = hueToRgb(p, q, h - 1.0/3.0);
        }
        return vec3(r, g, b);
      }

      vec3 darken(vec3 rgb, float amount) {
        vec3 hsl = rgbToHsl(rgb);
        hsl.z = clamp(hsl.z - amount, 0.0, 1.0);
        return hslToRgb(hsl);
      }

      void main() {
        if (v_color.a <= 0.0) {
          discard;
        }

        vec4 color = v_color;
        float flags = v_flags;
        bool isDefended = mod(flags, 2.0) >= 1.0;
        flags = floor(flags / 2.0);
        bool hasFriendly = mod(flags, 2.0) >= 1.0;
        flags = floor(flags / 2.0);
        bool hasEmbargo = mod(flags, 2.0) >= 1.0;
        flags = floor(flags / 2.0);
        bool lightTile = mod(flags, 2.0) >= 1.0;

        if (u_alternativeView) {
          color = relationColor(v_relation);
          color.a = 1.0;
        } else {
          // Relationship-based tinting (embargo -> red, friendly -> green)
          if (hasEmbargo) {
            color.rgb = mix(color.rgb, vec3(1.0, 0.0, 0.0), 0.35);
          } else if (hasFriendly) {
            color.rgb = mix(color.rgb, vec3(0.0, 1.0, 0.0), 0.35);
          }

          // Defended checkerboard pattern using light/dark variants
          if (isDefended) {
            vec3 lightColor = darken(color.rgb, 0.2);
            vec3 darkColor = darken(color.rgb, 0.4);
            color.rgb = lightTile ? lightColor : darkColor;
          }
        }

        if (
          u_hoveredPlayerId >= 0.0 &&
          abs(v_owner - u_hoveredPlayerId) < 0.5
        ) {
          float pulse =
            u_hoverPulse
              ? (1.0 - u_hoverPulseStrength) +
                u_hoverPulseStrength *
                  (0.5 + 0.5 * sin(u_time * u_hoverPulseSpeed))
              : 1.0;
          color.rgb = mix(
            color.rgb,
            u_highlightColor,
            u_highlightStrength * pulse
          );
        }

        // Optional blinking/pulsing effect to highlight WebGL-drawn borders.
        // Enabled only when u_debugPulse is true. Pulses between 0.5 and 1.0 opacity
        // using a smooth sine wave animation with ~1 second period.
        if (u_debugPulse) {
          float pulse = 0.75 + 0.25 * sin(u_time * 6.28318); // 2 * PI for full cycle
          color.a *= pulse;
        }

        gl_FragColor = color;
      }
    `;

    const vertexShader = this.compileShader(
      gl.VERTEX_SHADER,
      vertexShaderSource,
    );
    const fragmentShader = this.compileShader(
      gl.FRAGMENT_SHADER,
      fragmentShaderSource,
    );

    this.program = this.createProgram(vertexShader, fragmentShader);
    if (!this.program) {
      this.vertexBuffer = null;
      this.uniforms = {
        alternativeView: null,
        hoveredPlayerId: null,
        highlightStrength: null,
        highlightColor: null,
        hoverPulseStrength: null,
        hoverPulseSpeed: null,
        resolution: null,
        themeSelf: null,
        themeFriendly: null,
        themeNeutral: null,
        themeEnemy: null,
        time: null,
        debugPulse: null,
        hoverPulse: null,
      };
      return;
    }

    const program = this.program;
    gl.useProgram(program);

    this.vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);

    const positionLocation = gl.getAttribLocation(program, "a_position");
    const colorLocation = gl.getAttribLocation(program, "a_color");
    const ownerLocation = gl.getAttribLocation(program, "a_owner");
    const relationLocation = gl.getAttribLocation(program, "a_relation");
    const flagsLocation = gl.getAttribLocation(program, "a_flags");

    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(
      positionLocation,
      2,
      gl.FLOAT,
      false,
      TerritoryBorderWebGL.STRIDE_BYTES,
      0,
    );

    gl.enableVertexAttribArray(colorLocation);
    gl.vertexAttribPointer(
      colorLocation,
      4,
      gl.FLOAT,
      false,
      TerritoryBorderWebGL.STRIDE_BYTES,
      2 * 4,
    );

    gl.enableVertexAttribArray(ownerLocation);
    gl.vertexAttribPointer(
      ownerLocation,
      1,
      gl.FLOAT,
      false,
      TerritoryBorderWebGL.STRIDE_BYTES,
      6 * 4,
    );

    gl.enableVertexAttribArray(relationLocation);
    gl.vertexAttribPointer(
      relationLocation,
      1,
      gl.FLOAT,
      false,
      TerritoryBorderWebGL.STRIDE_BYTES,
      7 * 4,
    );

    gl.enableVertexAttribArray(flagsLocation);
    gl.vertexAttribPointer(
      flagsLocation,
      1,
      gl.FLOAT,
      false,
      TerritoryBorderWebGL.STRIDE_BYTES,
      8 * 4,
    );

    this.uniforms = {
      alternativeView: gl.getUniformLocation(program, "u_alternativeView"),
      hoveredPlayerId: gl.getUniformLocation(program, "u_hoveredPlayerId"),
      highlightStrength: gl.getUniformLocation(program, "u_highlightStrength"),
      highlightColor: gl.getUniformLocation(program, "u_highlightColor"),
      hoverPulseStrength: gl.getUniformLocation(
        program,
        "u_hoverPulseStrength",
      ),
      hoverPulseSpeed: gl.getUniformLocation(program, "u_hoverPulseSpeed"),
      resolution: gl.getUniformLocation(program, "u_resolution"),
      themeSelf: gl.getUniformLocation(program, "u_themeSelf"),
      themeFriendly: gl.getUniformLocation(program, "u_themeFriendly"),
      themeNeutral: gl.getUniformLocation(program, "u_themeNeutral"),
      themeEnemy: gl.getUniformLocation(program, "u_themeEnemy"),
      time: gl.getUniformLocation(program, "u_time"),
      debugPulse: gl.getUniformLocation(program, "u_debugPulse"),
      hoverPulse: gl.getUniformLocation(program, "u_hoverPulse"),
    };

    if (this.uniforms.hoveredPlayerId) {
      gl.uniform1f(this.uniforms.hoveredPlayerId, -1);
    }
    if (this.uniforms.highlightStrength) {
      gl.uniform1f(
        this.uniforms.highlightStrength,
        this.hoverHighlightStrength,
      );
    }
    if (this.uniforms.highlightColor) {
      const [r, g, b] = this.hoverHighlightColor;
      gl.uniform3f(this.uniforms.highlightColor, r, g, b);
    }
    if (this.uniforms.hoverPulseStrength) {
      gl.uniform1f(this.uniforms.hoverPulseStrength, this.hoverPulseStrength);
    }
    if (this.uniforms.hoverPulseSpeed) {
      gl.uniform1f(this.uniforms.hoverPulseSpeed, this.hoverPulseSpeed);
    }
    if (this.uniforms.resolution) {
      gl.uniform2f(this.uniforms.resolution, this.width, this.height);
    }
    if (this.uniforms.hoverPulse) {
      gl.uniform1i(this.uniforms.hoverPulse, 0);
    }
    this.applyThemeUniforms();

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.viewport(0, 0, width, height);
  }

  isValid(): boolean {
    return !!this.gl && !!this.program && !!this.vertexBuffer;
  }

  setAlternativeView(enabled: boolean) {
    if (this.alternativeView === enabled) {
      return;
    }
    this.alternativeView = enabled;
    this.needsRedraw = true;
  }

  setHoveredPlayerId(playerSmallId: number | null) {
    const encoded = playerSmallId ?? -1;
    let changed = false;
    if (this.hoveredPlayerId !== encoded) {
      this.hoveredPlayerId = encoded;
      changed = true;
    }
    const shouldPulse = playerSmallId !== null;
    if (this.hoverPulseEnabled !== shouldPulse) {
      this.hoverPulseEnabled = shouldPulse;
      changed = true;
    }
    if (changed) {
      this.needsRedraw = true;
    }
  }

  setHoverHighlightOptions(options: HoverHighlightOptions) {
    if (options.strength !== undefined) {
      this.hoverHighlightStrength = Math.max(0, Math.min(1, options.strength));
    }
    if (options.color) {
      const rgba = options.color.rgba;
      this.hoverHighlightColor = [rgba.r / 255, rgba.g / 255, rgba.b / 255];
    }
    if (options.pulseStrength !== undefined) {
      this.hoverPulseStrength = Math.max(0, Math.min(1, options.pulseStrength));
    }
    if (options.pulseSpeed !== undefined) {
      this.hoverPulseSpeed = Math.max(0, options.pulseSpeed);
    }
    this.needsRedraw = true;
  }

  setDebugPulseEnabled(enabled: boolean) {
    if (this.debugPulseEnabled === enabled) {
      return;
    }
    this.debugPulseEnabled = enabled;
    this.needsRedraw = true;
  }

  clearTile(tileIndex: number) {
    this.updateEdges(tileIndex, []);
  }

  updateEdges(tileIndex: number, edges: BorderEdge[]) {
    const span = FrameProfiler.start();

    if (!this.gl || !this.vertexBuffer || !this.program) {
      FrameProfiler.end(
        "TerritoryBorderWebGL:updateEdges.noContextOrProgram",
        span,
      );
      return;
    }

    if (edges.length === 0) {
      const removeSpan = FrameProfiler.start();
      this.removeTileEdges(tileIndex);
      FrameProfiler.end(
        "TerritoryBorderWebGL:updateEdges.removeTileEdges",
        removeSpan,
      );
      FrameProfiler.end("TerritoryBorderWebGL:updateEdges.total", span);
      return;
    }

    let chunk = this.tileToChunk.get(tileIndex);
    if (chunk === undefined) {
      const addChunkSpan = FrameProfiler.start();
      chunk = this.addTileChunk(tileIndex);
      FrameProfiler.end(
        "TerritoryBorderWebGL:updateEdges.addTileChunk",
        addChunkSpan,
      );
    }

    const writeChunkSpan = FrameProfiler.start();
    this.writeChunk(chunk, edges);
    FrameProfiler.end(
      "TerritoryBorderWebGL:updateEdges.writeChunk",
      writeChunkSpan,
    );
    this.needsRedraw = true;

    FrameProfiler.end("TerritoryBorderWebGL:updateEdges.total", span);
  }

  render() {
    if (!this.gl || !this.program || !this.vertexBuffer) {
      return;
    }
    if (this.dirtyChunks.size > 0) {
      const uploadSpan = FrameProfiler.start();
      this.uploadDirtyChunks();
      FrameProfiler.end(
        "TerritoryBorderWebGL:render.uploadDirtyChunks",
        uploadSpan,
      );
      this.needsRedraw = true;
    }

    // Always redraw for animation, but check if we have anything to draw
    if (!this.needsRedraw && this.vertexCount === 0) {
      return;
    }

    const gl = this.gl;
    const span = FrameProfiler.start();
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);

    if (this.uniforms.alternativeView) {
      gl.uniform1i(this.uniforms.alternativeView, this.alternativeView ? 1 : 0);
    }
    if (this.uniforms.hoveredPlayerId) {
      gl.uniform1f(this.uniforms.hoveredPlayerId, this.hoveredPlayerId);
    }

    // Update time uniform for blinking animation
    if (this.uniforms.time) {
      const currentTime = (Date.now() - this.animationStartTime) / 1000.0; // Convert to seconds
      gl.uniform1f(this.uniforms.time, currentTime);
    }

    if (this.uniforms.debugPulse) {
      gl.uniform1i(this.uniforms.debugPulse, this.debugPulseEnabled ? 1 : 0);
    }
    if (this.uniforms.hoverPulse) {
      gl.uniform1i(this.uniforms.hoverPulse, this.hoverPulseEnabled ? 1 : 0);
    }
    if (this.uniforms.highlightStrength) {
      gl.uniform1f(
        this.uniforms.highlightStrength,
        this.hoverHighlightStrength,
      );
    }
    if (this.uniforms.highlightColor) {
      const [r, g, b] = this.hoverHighlightColor;
      gl.uniform3f(this.uniforms.highlightColor, r, g, b);
    }
    if (this.uniforms.hoverPulseStrength) {
      gl.uniform1f(this.uniforms.hoverPulseStrength, this.hoverPulseStrength);
    }
    if (this.uniforms.hoverPulseSpeed) {
      gl.uniform1f(this.uniforms.hoverPulseSpeed, this.hoverPulseSpeed);
    }

    const drawSpan = FrameProfiler.start();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (this.vertexCount > 0) {
      gl.drawArrays(gl.LINES, 0, this.vertexCount);
    }
    FrameProfiler.end("TerritoryBorderWebGL:render.draw", drawSpan);

    // Always mark as needing redraw for continuous animation
    this.needsRedraw = true;

    FrameProfiler.end("TerritoryBorderWebGL:render.total", span);
  }

  private addTileChunk(tileIndex: number): number {
    const ensureSpan = FrameProfiler.start();
    this.ensureCapacity(this.usedChunks + 1);
    FrameProfiler.end(
      "TerritoryBorderWebGL:addTileChunk.ensureCapacity",
      ensureSpan,
    );
    const chunkIndex = this.usedChunks;
    this.usedChunks++;
    this.vertexCount =
      this.usedChunks * TerritoryBorderWebGL.MAX_VERTICES_PER_TILE;
    this.tileToChunk.set(tileIndex, chunkIndex);
    this.chunkToTile[chunkIndex] = tileIndex;
    return chunkIndex;
  }

  private removeTileEdges(tileIndex: number) {
    const span = FrameProfiler.start();

    const chunk = this.tileToChunk.get(tileIndex);
    if (chunk === undefined) {
      FrameProfiler.end("TerritoryBorderWebGL:removeTileEdges.noChunk", span);
      return;
    }
    const lastChunk = this.usedChunks - 1;
    const lastTile = this.chunkToTile[lastChunk];

    if (chunk !== lastChunk && lastTile !== undefined) {
      const chunkFloats = TerritoryBorderWebGL.FLOATS_PER_TILE;
      const destStart = chunk * chunkFloats;
      const srcStart = lastChunk * chunkFloats;
      this.vertexData.copyWithin(destStart, srcStart, srcStart + chunkFloats);
      this.tileToChunk.set(lastTile, chunk);
      this.chunkToTile[chunk] = lastTile;
      this.dirtyChunks.add(chunk);
    }

    this.tileToChunk.delete(tileIndex);
    this.chunkToTile.length = Math.max(0, this.usedChunks - 1);
    this.usedChunks = Math.max(0, this.usedChunks - 1);
    this.vertexCount =
      this.usedChunks * TerritoryBorderWebGL.MAX_VERTICES_PER_TILE;
    this.needsRedraw = true;

    if (chunk === this.usedChunks) {
      // Removed last chunk; nothing further to update.
      FrameProfiler.end(
        "TerritoryBorderWebGL:removeTileEdges.removedLastChunk",
        span,
      );
      return;
    }

    FrameProfiler.end("TerritoryBorderWebGL:removeTileEdges.total", span);
  }

  private writeChunk(chunk: number, edges: BorderEdge[]) {
    const span = FrameProfiler.start();

    const maxEdges = TerritoryBorderWebGL.MAX_EDGES_PER_TILE;
    const floatsPerVertex = TerritoryBorderWebGL.FLOATS_PER_VERTEX;
    const chunkFloats = TerritoryBorderWebGL.FLOATS_PER_TILE;
    const start = chunk * chunkFloats;
    const data = this.vertexData;

    let cursor = start;
    let writtenVertices = 0;

    for (let i = 0; i < Math.min(edges.length, maxEdges); i++) {
      const edge = edges[i];
      const color = edge.color.rgba;
      const r = color.r / 255;
      const g = color.g / 255;
      const b = color.b / 255;
      const a = color.a ?? 1;
      const ownerId = edge.ownerSmallId;
      const relation = edge.relation;
      const flags = edge.flags;

      const vertices = [
        { x: edge.startX, y: edge.startY },
        { x: edge.endX, y: edge.endY },
      ];

      for (const vertex of vertices) {
        data[cursor] = vertex.x;
        data[cursor + 1] = vertex.y;
        data[cursor + 2] = r;
        data[cursor + 3] = g;
        data[cursor + 4] = b;
        data[cursor + 5] = a;
        data[cursor + 6] = ownerId;
        data[cursor + 7] = relation;
        data[cursor + 8] = flags;
        cursor += floatsPerVertex;
        writtenVertices++;
      }
    }

    const remainingVertices =
      TerritoryBorderWebGL.MAX_VERTICES_PER_TILE - writtenVertices;

    for (let i = 0; i < remainingVertices; i++) {
      data[cursor] = 0;
      data[cursor + 1] = 0;
      data[cursor + 2] = 0;
      data[cursor + 3] = 0;
      data[cursor + 4] = 0;
      data[cursor + 5] = 0;
      data[cursor + 6] = -1;
      data[cursor + 7] = 0;
      data[cursor + 8] = 0;
      cursor += floatsPerVertex;
    }

    this.dirtyChunks.add(chunk);

    FrameProfiler.end("TerritoryBorderWebGL:writeChunk", span);
  }

  private uploadDirtyChunks() {
    if (!this.gl || !this.vertexBuffer) {
      return;
    }
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    const chunkFloats = TerritoryBorderWebGL.FLOATS_PER_TILE;
    for (const chunk of this.dirtyChunks) {
      if (chunk >= this.usedChunks) {
        continue;
      }
      const start = chunk * chunkFloats;
      const view = this.vertexData.subarray(start, start + chunkFloats);
      gl.bufferSubData(gl.ARRAY_BUFFER, start * 4, view);
    }
    this.dirtyChunks.clear();
  }

  private ensureCapacity(requiredChunks: number) {
    if (requiredChunks <= this.capacityChunks) {
      return;
    }
    const span = FrameProfiler.start();
    let nextCapacity = this.capacityChunks;
    while (nextCapacity < requiredChunks) {
      nextCapacity *= 2;
    }
    // Debug: log capacity growth so we can see typical ranges in real games.

    console.log(
      "[TerritoryBorderWebGL] growing capacityChunks",
      "from",
      this.capacityChunks,
      "to",
      nextCapacity,
      "requiredChunks=",
      requiredChunks,
    );
    const nextData = new Float32Array(
      nextCapacity * TerritoryBorderWebGL.FLOATS_PER_TILE,
    );
    nextData.set(
      this.vertexData.subarray(
        0,
        this.usedChunks * TerritoryBorderWebGL.FLOATS_PER_TILE,
      ),
    );
    this.vertexData = nextData;
    this.capacityChunks = nextCapacity;

    if (this.gl && this.vertexBuffer) {
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
      this.gl.bufferData(
        this.gl.ARRAY_BUFFER,
        this.vertexData,
        this.gl.DYNAMIC_DRAW,
      );
      this.dirtyChunks.clear();
    }

    FrameProfiler.end("TerritoryBorderWebGL:ensureCapacity.grow", span);
  }

  private applyThemeUniforms() {
    if (!this.gl || !this.program) return;
    const gl = this.gl;
    const toVec4 = (col: Colord) => {
      const rgba = col.rgba;
      return [rgba.r / 255, rgba.g / 255, rgba.b / 255, rgba.a ?? 1];
    };
    const setColor = (location: WebGLUniformLocation | null, col: Colord) => {
      if (!location) return;
      const vec = toVec4(col);
      gl.uniform4f(location, vec[0], vec[1], vec[2], vec[3]);
    };
    setColor(this.uniforms.themeSelf, this.theme.selfColor());
    setColor(this.uniforms.themeFriendly, this.theme.allyColor());
    setColor(this.uniforms.themeNeutral, this.theme.neutralColor());
    setColor(this.uniforms.themeEnemy, this.theme.enemyColor());
  }

  private compileShader(type: number, source: string): WebGLShader | null {
    if (!this.gl) return null;
    const shader = this.gl.createShader(type);
    if (!shader) return null;
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      console.error(
        "TerritoryBorderWebGL shader error",
        this.gl.getShaderInfoLog(shader),
      );
      this.gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  private createProgram(
    vertexShader: WebGLShader | null,
    fragmentShader: WebGLShader | null,
  ): WebGLProgram | null {
    if (!this.gl || !vertexShader || !fragmentShader) return null;
    const program = this.gl.createProgram();
    if (!program) return null;
    this.gl.attachShader(program, vertexShader);
    this.gl.attachShader(program, fragmentShader);
    this.gl.linkProgram(program);
    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      console.error(
        "TerritoryBorderWebGL link error",
        this.gl.getProgramInfoLog(program),
      );
      this.gl.deleteProgram(program);
      return null;
    }
    return program;
  }
}
