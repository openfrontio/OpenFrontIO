import { GameView } from "../../../core/game/GameView";
import { TransformHandler } from "../TransformHandler";
import { WebGLUtils } from "../webgl/WebGLUtils";
import { Layer } from "./Layer";
import { TerrainLayer } from "./TerrainLayer";

export class WebGLTerrainLayer implements Layer {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private fallbackLayer: TerrainLayer | null = null;
  private isWebGLInitialized = false;

  // Vertex shader that renders a full-screen quad
  private static readonly VERTEX_SHADER_SOURCE = `
    attribute vec2 a_position;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  // Fragment shader that renders solid red color
  private static readonly FRAGMENT_SHADER_SOURCE = `
    precision mediump float;
    void main() {
      gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); // Solid red
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
    console.log("🔴 WEBGL TERRAIN LAYER: Initializing WebGL terrain layer");

    if (!WebGLUtils.isWebGLSupported()) {
      console.warn(
        "🔴 WEBGL TERRAIN LAYER: WebGL not supported, falling back to canvas terrain layer",
      );
      this.fallbackToCanvas();
      return;
    }

    if (this.initWebGL()) {
      console.log(
        "🔴 WEBGL TERRAIN LAYER: WebGL terrain layer initialized successfully - YOU SHOULD SEE RED TERRAIN!",
      );
      this.isWebGLInitialized = true;
      this.redraw();
    } else {
      console.warn(
        "🔴 WEBGL TERRAIN LAYER: WebGL initialization failed, falling back to canvas terrain layer",
      );
      this.fallbackToCanvas();
    }
  }

  tick(): void {
    if (this.fallbackLayer) {
      this.fallbackLayer.tick();
    }
    // For WebGL implementation, we don't need to check theme changes yet
    // since we're just rendering solid red
  }

  redraw(): void {
    if (!this.isWebGLInitialized) {
      if (this.fallbackLayer) {
        this.fallbackLayer.redraw();
      }
      return;
    }

    this.renderToCanvas();
  }

  renderLayer(context: CanvasRenderingContext2D): void {
    if (this.fallbackLayer) {
      this.fallbackLayer.renderLayer(context);
      return;
    }

    if (!this.isWebGLInitialized) {
      return;
    }

    // Draw the WebGL-rendered canvas to the main context
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

    // Create shaders
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

    // Create a full-screen quad
    const positions = new Float32Array([
      -1.0,
      -1.0, // Bottom left
      1.0,
      -1.0, // Bottom right
      -1.0,
      1.0, // Top left
      1.0,
      1.0, // Top right
    ]);

    const positionBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, positionBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, positions, this.gl.STATIC_DRAW);

    // Get attribute location
    const positionAttributeLocation = this.gl.getAttribLocation(
      this.program,
      "a_position",
    );
    this.gl.enableVertexAttribArray(positionAttributeLocation);
    this.gl.vertexAttribPointer(
      positionAttributeLocation,
      2,
      this.gl.FLOAT,
      false,
      0,
      0,
    );

    return true;
  }

  private renderToCanvas(): void {
    if (!this.gl || !this.program) {
      return;
    }

    // Set viewport
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    // Clear with transparent background
    this.gl.clearColor(0.0, 0.0, 0.0, 0.0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);

    // Use our shader program
    this.gl.useProgram(this.program);

    // Draw the quad (red rectangle covering the entire canvas)
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
  }

  private fallbackToCanvas(): void {
    this.fallbackLayer = new TerrainLayer(this.game, this.transformHandler);
    this.fallbackLayer.init();
  }
}
