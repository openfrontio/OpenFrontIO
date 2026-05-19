/**
 * Data texture factories for the NamePass subsystem.
 * Uses createTexture2D from gl-utils to eliminate boilerplate.
 */

import { createTexture2D } from "../../utils/GlUtils";
import type { ParsedAtlas } from "./Types";
import { CHAR_RANGE, LINES_PER_PLAYER, MAX_CHARS } from "./Types";

/** Glyph metrics: CHAR_RANGE x 2, RGBA32F. Static — uploaded once. */
export function buildGlyphMetricsTex(
  gl: WebGL2RenderingContext,
  atlas: ParsedAtlas,
): WebGLTexture {
  const data = new Float32Array(CHAR_RANGE * 2 * 4);

  for (const ch of atlas.chars) {
    if (ch.id >= CHAR_RANGE) continue;
    // Row 0: xadvance, xoffset, yoffset, width
    const r0 = ch.id * 4;
    data[r0 + 0] = ch.xadvance;
    data[r0 + 1] = ch.xoffset;
    data[r0 + 2] = ch.yoffset;
    data[r0 + 3] = ch.width;
    // Row 1: height, atlasU0, atlasV0, atlasU1
    const r1 = (CHAR_RANGE + ch.id) * 4;
    data[r1 + 0] = ch.height;
    data[r1 + 1] = ch.x / atlas.scaleW;
    data[r1 + 2] = ch.y / atlas.scaleH;
    data[r1 + 3] = (ch.x + ch.width) / atlas.scaleW;
    // v1 is computed in shader as v0 + height/scaleH
  }

  return createTexture2D(gl, {
    width: CHAR_RANGE,
    height: 2,
    internalFormat: gl.RGBA32F,
    format: gl.RGBA,
    type: gl.FLOAT,
    data,
  });
}

/** Cursor positions: MAX_CHARS x (maxPlayers * LINES_PER_PLAYER), R32F. Dynamic. */
export function buildCursorTex(
  gl: WebGL2RenderingContext,
  maxPlayers: number,
): WebGLTexture {
  const height = maxPlayers * LINES_PER_PLAYER;
  return createTexture2D(gl, {
    width: MAX_CHARS,
    height,
    internalFormat: gl.R32F,
    format: gl.RED,
    type: gl.FLOAT,
    data: new Float32Array(MAX_CHARS * height),
  });
}

/** String data: MAX_CHARS x (maxPlayers * LINES_PER_PLAYER), R8UI. Dynamic. */
export function buildStringTex(
  gl: WebGL2RenderingContext,
  maxPlayers: number,
): WebGLTexture {
  const height = maxPlayers * LINES_PER_PLAYER;
  return createTexture2D(gl, {
    width: MAX_CHARS,
    height,
    internalFormat: gl.R8UI,
    format: gl.RED_INTEGER,
    type: gl.UNSIGNED_BYTE,
    data: new Uint8Array(MAX_CHARS * height),
  });
}

/** Player data: 8 x maxPlayers, RGBA32F. Dynamic. */
export function buildPlayerDataTex(
  gl: WebGL2RenderingContext,
  maxPlayers: number,
): WebGLTexture {
  return createTexture2D(gl, {
    width: 8,
    height: maxPlayers,
    internalFormat: gl.RGBA32F,
    format: gl.RGBA,
    type: gl.FLOAT,
    data: new Float32Array(8 * maxPlayers * 4),
  });
}
