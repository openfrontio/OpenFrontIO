/**
 * GPUResources — shared GPU textures created once, passed to all passes.
 *
 * Eliminates getter chains, setBorderTex/setHeatTex late-wiring, and
 * construction-order dependencies between passes.
 */

import { createTexture2D } from "./GlUtils";

export interface GPUResources {
  tileTex: WebGLTexture; // R16UI  — tile ownership + flags
  trailTex: WebGLTexture; // R8UI   — trail owner per tile
  paletteTex: WebGLTexture; // RGBA32F — player colors
  borderTex: WebGLTexture; // RGBA8  — border type + defense + relation (G unused)
  heatTexA: WebGLTexture; // R8     — fallout heat ping-pong A
  heatTexB: WebGLTexture; // R8     — fallout heat ping-pong B
}

export function createGPUResources(
  gl: WebGL2RenderingContext,
  mapW: number,
  mapH: number,
  paletteTex: WebGLTexture,
  borderTex: WebGLTexture,
): GPUResources {
  const tileTex = createTexture2D(gl, {
    width: mapW,
    height: mapH,
    internalFormat: gl.R16UI,
    format: gl.RED_INTEGER,
    type: gl.UNSIGNED_SHORT,
    data: null,
    filter: gl.NEAREST,
  });

  const trailTex = createTexture2D(gl, {
    width: mapW,
    height: mapH,
    internalFormat: gl.R8UI,
    format: gl.RED_INTEGER,
    type: gl.UNSIGNED_BYTE,
    data: null,
    filter: gl.NEAREST,
  });

  const heatTexA = createTexture2D(gl, {
    width: mapW,
    height: mapH,
    internalFormat: gl.R8,
    format: gl.RED,
    type: gl.UNSIGNED_BYTE,
    data: null,
    filter: gl.NEAREST,
  });

  const heatTexB = createTexture2D(gl, {
    width: mapW,
    height: mapH,
    internalFormat: gl.R8,
    format: gl.RED,
    type: gl.UNSIGNED_BYTE,
    data: null,
    filter: gl.NEAREST,
  });

  return { tileTex, trailTex, paletteTex, borderTex, heatTexA, heatTexB };
}

export function disposeGPUResources(
  gl: WebGL2RenderingContext,
  res: GPUResources,
): void {
  gl.deleteTexture(res.tileTex);
  gl.deleteTexture(res.trailTex);
  // paletteTex and borderTex are owned by renderer and BorderComputePass respectively
  gl.deleteTexture(res.heatTexA);
  gl.deleteTexture(res.heatTexB);
}
