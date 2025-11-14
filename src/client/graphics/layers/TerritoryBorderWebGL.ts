import { Colord } from "colord";
import { Theme } from "../../../core/configuration/Config";

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
}

interface UniformLocations {
  alternativeView: WebGLUniformLocation | null;
  hoveredPlayerId: WebGLUniformLocation | null;
  highlightStrength: WebGLUniformLocation | null;
  resolution: WebGLUniformLocation | null;
  themeSelf: WebGLUniformLocation | null;
  themeFriendly: WebGLUniformLocation | null;
  themeNeutral: WebGLUniformLocation | null;
  themeEnemy: WebGLUniformLocation | null;
  time: WebGLUniformLocation | null;
  debugPulse: WebGLUniformLocation | null;
}

export class TerritoryBorderWebGL {
  private static readonly INITIAL_CHUNK_CAPACITY = 256;
  private static readonly MAX_EDGES_PER_TILE = 4;
  private static readonly VERTICES_PER_EDGE = 2;
  private static readonly MAX_VERTICES_PER_TILE =
    TerritoryBorderWebGL.MAX_EDGES_PER_TILE *
    TerritoryBorderWebGL.VERTICES_PER_EDGE;
  private static readonly FLOATS_PER_VERTEX = 8;
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
    const renderer = new TerritoryBorderWebGL(width, height, theme);
    return renderer.isValid() ? renderer : null;
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

    if (!this.gl) {
      this.program = null;
      this.vertexBuffer = null;
      this.uniforms = {
        alternativeView: null,
        hoveredPlayerId: null,
        highlightStrength: null,
        resolution: null,
        themeSelf: null,
        themeFriendly: null,
        themeNeutral: null,
        themeEnemy: null,
        time: null,
        debugPulse: null,
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

      uniform vec2 u_resolution;

      varying vec4 v_color;
      varying float v_owner;
      varying float v_relation;

      void main() {
        vec2 zeroToOne = a_position / u_resolution;
        vec2 clipSpace = zeroToOne * 2.0 - 1.0;
        clipSpace.y = -clipSpace.y;
        gl_Position = vec4(clipSpace, 0.0, 1.0);
        v_color = a_color;
        v_owner = a_owner;
        v_relation = a_relation;
      }
    `;
    const fragmentShaderSource = `
      precision mediump float;

      uniform bool u_alternativeView;
      uniform float u_hoveredPlayerId;
      uniform float u_highlightStrength;
      uniform vec4 u_themeSelf;
      uniform vec4 u_themeFriendly;
      uniform vec4 u_themeNeutral;
      uniform vec4 u_themeEnemy;
      uniform float u_time;
      uniform bool u_debugPulse;

      varying vec4 v_color;
      varying float v_owner;
      varying float v_relation;

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

      void main() {
        if (v_color.a <= 0.0) {
          discard;
        }

        vec4 color = v_color;
        if (u_alternativeView) {
          color = relationColor(v_relation);
          color.a = 1.0;
        }

        if (
          u_hoveredPlayerId >= 0.0 &&
          abs(v_owner - u_hoveredPlayerId) < 0.5
        ) {
          color.rgb = mix(color.rgb, vec3(1.0), u_highlightStrength);
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
        resolution: null,
        themeSelf: null,
        themeFriendly: null,
        themeNeutral: null,
        themeEnemy: null,
        time: null,
        debugPulse: null,
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

    this.uniforms = {
      alternativeView: gl.getUniformLocation(program, "u_alternativeView"),
      hoveredPlayerId: gl.getUniformLocation(program, "u_hoveredPlayerId"),
      highlightStrength: gl.getUniformLocation(program, "u_highlightStrength"),
      resolution: gl.getUniformLocation(program, "u_resolution"),
      themeSelf: gl.getUniformLocation(program, "u_themeSelf"),
      themeFriendly: gl.getUniformLocation(program, "u_themeFriendly"),
      themeNeutral: gl.getUniformLocation(program, "u_themeNeutral"),
      themeEnemy: gl.getUniformLocation(program, "u_themeEnemy"),
      time: gl.getUniformLocation(program, "u_time"),
      debugPulse: gl.getUniformLocation(program, "u_debugPulse"),
    };

    if (this.uniforms.hoveredPlayerId) {
      gl.uniform1f(this.uniforms.hoveredPlayerId, -1);
    }
    if (this.uniforms.highlightStrength) {
      gl.uniform1f(this.uniforms.highlightStrength, 0.35);
    }
    if (this.uniforms.resolution) {
      gl.uniform2f(this.uniforms.resolution, this.width, this.height);
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
    if (this.hoveredPlayerId === encoded) {
      return;
    }
    this.hoveredPlayerId = encoded;
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
    if (!this.gl || !this.vertexBuffer || !this.program) {
      return;
    }

    if (edges.length === 0) {
      this.removeTileEdges(tileIndex);
      return;
    }

    let chunk = this.tileToChunk.get(tileIndex);
    chunk ??= this.addTileChunk(tileIndex);

    this.writeChunk(chunk, edges);
    this.needsRedraw = true;
  }

  render() {
    if (!this.gl || !this.program || !this.vertexBuffer) {
      return;
    }
    if (this.dirtyChunks.size > 0) {
      this.uploadDirtyChunks();
      this.needsRedraw = true;
    }

    // Always redraw for animation, but check if we have anything to draw
    if (!this.needsRedraw && this.vertexCount === 0) {
      return;
    }

    const gl = this.gl;
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

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (this.vertexCount > 0) {
      gl.drawArrays(gl.LINES, 0, this.vertexCount);
    }

    // Always mark as needing redraw for continuous animation
    this.needsRedraw = true;
  }

  private addTileChunk(tileIndex: number): number {
    this.ensureCapacity(this.usedChunks + 1);
    const chunkIndex = this.usedChunks;
    this.usedChunks++;
    this.vertexCount =
      this.usedChunks * TerritoryBorderWebGL.MAX_VERTICES_PER_TILE;
    this.tileToChunk.set(tileIndex, chunkIndex);
    this.chunkToTile[chunkIndex] = tileIndex;
    return chunkIndex;
  }

  private removeTileEdges(tileIndex: number) {
    const chunk = this.tileToChunk.get(tileIndex);
    if (chunk === undefined) {
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
      return;
    }
  }

  private writeChunk(chunk: number, edges: BorderEdge[]) {
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
      cursor += floatsPerVertex;
    }

    this.dirtyChunks.add(chunk);
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
    let nextCapacity = this.capacityChunks;
    while (nextCapacity < requiredChunks) {
      nextCapacity *= 2;
    }
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
