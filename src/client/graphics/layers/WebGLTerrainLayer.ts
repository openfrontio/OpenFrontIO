import { Theme } from "../../../core/configuration/Config";
import { GameView } from "../../../core/game/GameView";
import { TransformHandler } from "../TransformHandler";
import { WebGLUtils } from "../webgl/WebGLUtils";
import { Layer } from "./Layer";
import { TerrainLayer } from "./TerrainLayer";

export class WebGLTerrainLayer implements Layer {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private texture: WebGLTexture | null = null;
  private fallbackLayer: TerrainLayer | null = null;
  private isWebGLInitialized = false;
  private theme: Theme;
  private textureUniformLocation: WebGLUniformLocation | null = null;
  private needsRedraw = false;

  private static readonly VERTEX_SHADER_SOURCE = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;
    
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_texCoord = a_texCoord;
    }
  `;

  private static readonly FRAGMENT_SHADER_SOURCE = `
    precision mediump float;
    uniform sampler2D u_texture;
    varying vec2 v_texCoord;
    
    void main() {
      gl_FragColor = texture2D(u_texture, v_texCoord);
    }
  `;

  constructor(
    private game: GameView,
    private transformHandler: TransformHandler,
  ) {
    this.canvas = document.createElement("canvas");
  }

  shouldTransform(): boolean {
    return true;
  }

  init(): void {
    console.log("WEBGL TERRAIN LAYER: Initializing WebGL terrain layer");

    if (!WebGLUtils.isWebGLSupported()) {
      console.warn(
        "WEBGL TERRAIN LAYER: WebGL not supported, falling back to canvas terrain layer",
      );
      this.fallbackToCanvas();
      return;
    }

    if (this.initWebGL()) {
      console.log(
        "WEBGL TERRAIN LAYER: WebGL terrain layer initialized successfully - YOU SHOULD SEE ACTUAL TERRAIN!",
      );
      this.isWebGLInitialized = true;
      this.redraw();
    } else {
      console.warn(
        "WEBGL TERRAIN LAYER: WebGL initialization failed, falling back to canvas terrain layer",
      );
      this.fallbackToCanvas();
    }
  }

  tick(): void {
    if (this.fallbackLayer) {
      this.fallbackLayer.tick();
      return;
    }

    if (this.isWebGLInitialized && this.game.config().theme() !== this.theme) {
      this.regenerateTerrainTexture();
    }
  }

  redraw(): void {
    if (!this.isWebGLInitialized) {
      if (this.fallbackLayer) {
        this.fallbackLayer.redraw();
      }
      return;
    }

    this.needsRedraw = true;
  }

  renderLayer(context: CanvasRenderingContext2D): void {
    if (this.fallbackLayer) {
      this.fallbackLayer.renderLayer(context);
      return;
    }

    if (!this.isWebGLInitialized) {
      return;
    }

    const frameStart = performance.now();

    if (this.needsRedraw) {
      this.renderToCanvas();
      this.needsRedraw = false;
    }

    if (this.transformHandler.scale < 1) {
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "low";
    } else {
      context.imageSmoothingEnabled = false;
    }

    context.drawImage(
      this.canvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
  }

  private initWebGL(): boolean {
    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();

    this.gl = this.canvas.getContext("webgl") as WebGLRenderingContext | null;
    if (!this.gl) {
      console.error("Failed to get WebGL context");
      return false;
    }

    const vertexShader = WebGLUtils.createShader(
      this.gl,
      this.gl.VERTEX_SHADER,
      WebGLTerrainLayer.VERTEX_SHADER_SOURCE,
    );
    const fragmentShader = WebGLUtils.createShader(
      this.gl,
      this.gl.FRAGMENT_SHADER,
      WebGLTerrainLayer.FRAGMENT_SHADER_SOURCE,
    );

    if (!vertexShader || !fragmentShader) {
      console.error("Failed to create shaders");
      return false;
    }

    // Create program
    this.program = WebGLUtils.createProgram(
      this.gl,
      vertexShader,
      fragmentShader,
    );
    if (!this.program) {
      console.error("Failed to create shader program");
      return false;
    }

    // Format: [x, y, u, v] for each vertex
    const vertexData = new Float32Array([
      // Position    // Texture coords
      -1.0,
      -1.0,
      0.0,
      1.0, // Bottom left
      1.0,
      -1.0,
      1.0,
      1.0, // Bottom right
      -1.0,
      1.0,
      0.0,
      0.0, // Top left
      1.0,
      1.0,
      1.0,
      0.0, // Top right
    ]);

    const vertexBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, vertexBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, vertexData, this.gl.STATIC_DRAW);

    const positionAttributeLocation = this.gl.getAttribLocation(
      this.program,
      "a_position",
    );
    this.gl.enableVertexAttribArray(positionAttributeLocation);
    this.gl.vertexAttribPointer(
      positionAttributeLocation,
      2, // 2 components per vertex (x, y)
      this.gl.FLOAT,
      false,
      4 * 4, // stride: 4 floats * 4 bytes per float
      0, // offset: start at beginning
    );

    // Set up texture coordinate attribute
    const texCoordAttributeLocation = this.gl.getAttribLocation(
      this.program,
      "a_texCoord",
    );
    this.gl.enableVertexAttribArray(texCoordAttributeLocation);
    this.gl.vertexAttribPointer(
      texCoordAttributeLocation,
      2, // 2 components per vertex (u, v)
      this.gl.FLOAT,
      false,
      4 * 4, // stride: 4 floats * 4 bytes per float
      2 * 4, // offset: skip 2 floats (x, y) to get to texture coords
    );

    // Create terrain texture
    this.texture = this.createTerrainTexture();
    if (!this.texture) {
      console.error("Failed to create terrain texture");
      return false;
    }

    // Cache uniform location to avoid lookup on every frame
    this.textureUniformLocation = this.gl.getUniformLocation(
      this.program,
      "u_texture",
    );

    return true;
  }

  private createTerrainTexture(): WebGLTexture | null {
    if (!this.gl) {
      return null;
    }

    this.theme = this.game.config().theme();

    const width = this.game.width();
    const height = this.game.height();
    const data = new Uint8Array(width * height * 4); // RGBA

    // Generate terrain colors using the same logic as TerrainLayer
    this.game.forEachTile((tile) => {
      const terrainColor = this.theme.terrainColor(this.game, tile);
      const index = this.game.y(tile) * width + this.game.x(tile);
      const offset = index * 4;

      data[offset] = terrainColor.rgba.r;
      data[offset + 1] = terrainColor.rgba.g;
      data[offset + 2] = terrainColor.rgba.b;
      data[offset + 3] = (terrainColor.rgba.a * 255) | 0;
    });

    const texture = WebGLUtils.createTexture(this.gl, width, height, data);

    return texture;
  }

  private regenerateTerrainTexture(): void {
    if (!this.gl || !this.texture) {
      return;
    }

    const textureUploadStart = performance.now();

    this.theme = this.game.config().theme();
    const width = this.game.width();
    const height = this.game.height();
    const data = new Uint8Array(width * height * 4); // RGBA

    this.game.forEachTile((tile) => {
      const terrainColor = this.theme.terrainColor(this.game, tile);
      const index = this.game.y(tile) * width + this.game.x(tile);
      const offset = index * 4;

      data[offset] = terrainColor.rgba.r;
      data[offset + 1] = terrainColor.rgba.g;
      data[offset + 2] = terrainColor.rgba.b;
      data[offset + 3] = (terrainColor.rgba.a * 255) | 0;
    });

    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      width,
      height,
      0,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      data,
    );

    const textureUploadEnd = performance.now();
    this.redraw();
  }

  private renderToCanvas(): void {
    if (!this.gl || !this.program || !this.texture) {
      return;
    }

    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    this.gl.clearColor(0.0, 0.0, 0.0, 0.0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    this.gl.useProgram(this.program);
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    if (this.textureUniformLocation) {
      this.gl.uniform1i(this.textureUniformLocation, 0);
    }

    // Draw the textured quad
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
    const drawCallEnd = performance.now();
  }

  private fallbackToCanvas(): void {
    this.fallbackLayer = new TerrainLayer(this.game, this.transformHandler);
    this.fallbackLayer.init();
  }
}
