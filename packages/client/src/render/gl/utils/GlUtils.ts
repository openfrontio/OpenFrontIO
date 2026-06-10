/**
 * WebGL2 utility functions: shader compilation, texture creation, VAO helpers.
 */

export function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "";
    gl.deleteShader(shader);
    throw new Error(`Shader compile error:\n${log}`);
  }
  return shader;
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vertSrc: string,
  fragSrc: string,
): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "";
    gl.deleteProgram(program);
    throw new Error(`Program link error:\n${log}`);
  }
  return program;
}

export interface TextureOpts {
  width: number;
  height: number;
  internalFormat: number;
  format: number;
  type: number;
  data: ArrayBufferView | null;
  filter?: number;
  wrap?: number;
}

export function createTexture2D(
  gl: WebGL2RenderingContext,
  opts: TextureOpts,
): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MIN_FILTER,
    opts.filter ?? gl.NEAREST,
  );
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MAG_FILTER,
    opts.filter ?? gl.NEAREST,
  );
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_WRAP_S,
    opts.wrap ?? gl.CLAMP_TO_EDGE,
  );
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_WRAP_T,
    opts.wrap ?? gl.CLAMP_TO_EDGE,
  );
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    opts.internalFormat,
    opts.width,
    opts.height,
    0,
    opts.format,
    opts.type,
    opts.data,
  );
  return tex;
}

/**
 * Create a VAO with a quad covering [0,0]→[mapWidth, mapHeight] in world coords.
 * Two triangles, positions only. Attribute location 0.
 */
/**
 * Create a VAO with a [0,1]² fullscreen quad. Two triangles, positions only.
 * Attribute location 0. Used for post-process passes (blur, composite, etc.).
 */
export function createFullscreenQuad(
  gl: WebGL2RenderingContext,
): WebGLVertexArrayObject {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);

  const buf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  gl.bindVertexArray(null);
  return vao;
}

/**
 * Inject `#define` constants into a GLSL shader source string.
 * Inserts definitions immediately after the `#version` line.
 *
 * Usage:
 *   shaderSrc(blurFrag, { PALETTE_SIZE: 4096 })
 *   // → "#version 300 es\n#define PALETTE_SIZE 4096\n..."
 */
export function shaderSrc(
  source: string,
  defines: Record<string, number>,
): string {
  const defs = Object.entries(defines)
    .map(([k, v]) => `#define ${k} ${v}`)
    .join("\n");
  return source.replace("#version 300 es", `#version 300 es\n${defs}`);
}

export interface RenderTarget {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

/**
 * Bind a render target FBO, set viewport, clear, run draw callback, then
 * restore the default framebuffer. Returns the target texture for chaining.
 */
export function toTarget(
  gl: WebGL2RenderingContext,
  target: RenderTarget,
  draw: () => void,
): WebGLTexture {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
  gl.viewport(0, 0, target.w, target.h);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  draw();
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return target.tex;
}

/**
 * Bind the screen (default framebuffer), set viewport, run draw callback.
 */
export function toScreen(
  gl: WebGL2RenderingContext,
  w: number,
  h: number,
  draw: () => void,
): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, w, h);
  draw();
}

export function createMapQuad(
  gl: WebGL2RenderingContext,
  mapWidth: number,
  mapHeight: number,
): WebGLVertexArrayObject {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);

  const positions = new Float32Array([
    0,
    0,
    mapWidth,
    0,
    0,
    mapHeight,
    0,
    mapHeight,
    mapWidth,
    0,
    mapWidth,
    mapHeight,
  ]);

  const buf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  gl.bindVertexArray(null);
  return vao;
}
