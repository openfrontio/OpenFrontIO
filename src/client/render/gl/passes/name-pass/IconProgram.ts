/**
 * IconProgram — instanced flag + emoji icons beside player names.
 *
 * Owns the shader program and the emoji atlas texture. The flag texture is a
 * sampler2DArray populated at runtime by FlagAtlasArray (passed in, not owned).
 * The shared playerDataTex is also passed in but not owned/deleted.
 */

import emojiAtlasMeta from "resources/atlases/emoji-atlas-meta.json";
import { assetUrl } from "src/core/AssetUrls";
import type { RenderSettings } from "../../RenderSettings";
import iconFragSrc from "../../shaders/name/icon.frag.glsl?raw";
import iconVertSrc from "../../shaders/name/icon.vert.glsl?raw";
import { createProgram } from "../../utils/GlUtils";
import type { FlagAtlasArray } from "./FlagAtlasArray";
import type { ParsedAtlas } from "./Types";

const emojiAtlasUrl = assetUrl("atlases/emoji-atlas.png");

// Must match FLAG_CELL_W / FLAG_CELL_H in FlagAtlasArray.ts. Used only for
// world-space aspect ratio of the flag quad.
const FLAG_CELL_W = 128;
const FLAG_CELL_H = 85;

export class IconProgram {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private playerDataTex: WebGLTexture;
  private flagAtlas: FlagAtlasArray;
  private maxPlayers: number;

  private emojiAtlasTex: WebGLTexture | null = null;
  private emojiReady = false;

  // Dynamic uniform locations
  private uCamera: WebGLUniformLocation;
  private uTime: WebGLUniformLocation;
  private uLerpSpeed: WebGLUniformLocation;
  private uCullThreshold: WebGLUniformLocation;
  private uNameScaleFactor: WebGLUniformLocation;
  private uNameScaleCap: WebGLUniformLocation;
  private uEmojiRowOffset: WebGLUniformLocation;
  private uFadeOwnerID: WebGLUniformLocation;
  private uHoverFadeAlpha: WebGLUniformLocation;

  constructor(
    gl: WebGL2RenderingContext,
    atlas: ParsedAtlas,
    playerDataTex: WebGLTexture,
    flagAtlas: FlagAtlasArray,
    maxPlayers: number,
  ) {
    this.gl = gl;
    this.playerDataTex = playerDataTex;
    this.flagAtlas = flagAtlas;
    this.maxPlayers = maxPlayers;

    this.program = createProgram(gl, iconVertSrc, iconFragSrc);
    gl.useProgram(this.program);

    // Texture unit bindings
    gl.uniform1i(gl.getUniformLocation(this.program, "uPlayerData"), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "uFlagAtlas"), 1);
    gl.uniform1i(gl.getUniformLocation(this.program, "uEmojiAtlas"), 2);

    // Static uniforms from atlas metadata
    const em = emojiAtlasMeta as any;
    gl.uniform1f(
      gl.getUniformLocation(this.program, "uFontSize")!,
      atlas.fontSize,
    );
    gl.uniform1f(gl.getUniformLocation(this.program, "uFontBase")!, atlas.base);
    gl.uniform1f(
      gl.getUniformLocation(this.program, "uFlagCellW")!,
      FLAG_CELL_W,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.program, "uFlagCellH")!,
      FLAG_CELL_H,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.program, "uEmojiCell")!,
      em.cellSize,
    );
    gl.uniform1f(gl.getUniformLocation(this.program, "uEmojiCols")!, em.cols);
    gl.uniform1f(
      gl.getUniformLocation(this.program, "uEmojiAtlasW")!,
      em.width,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.program, "uEmojiAtlasH")!,
      em.height,
    );

    // Dynamic uniform locations
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uTime = gl.getUniformLocation(this.program, "uTime")!;
    this.uLerpSpeed = gl.getUniformLocation(this.program, "uLerpSpeed")!;
    this.uCullThreshold = gl.getUniformLocation(
      this.program,
      "uCullThreshold",
    )!;
    this.uNameScaleFactor = gl.getUniformLocation(
      this.program,
      "uNameScaleFactor",
    )!;
    this.uNameScaleCap = gl.getUniformLocation(this.program, "uNameScaleCap")!;
    this.uEmojiRowOffset = gl.getUniformLocation(
      this.program,
      "uEmojiRowOffset",
    )!;
    this.uFadeOwnerID = gl.getUniformLocation(this.program, "uFadeOwnerID")!;
    this.uHoverFadeAlpha = gl.getUniformLocation(
      this.program,
      "uHoverFadeAlpha",
    )!;

    this.loadEmojiAtlas();
  }

  get ready(): boolean {
    return this.emojiReady;
  }

  private loadEmojiAtlas(): void {
    const gl = this.gl;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_MIN_FILTER,
        gl.LINEAR_MIPMAP_LINEAR,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      this.emojiAtlasTex = tex;
      this.emojiReady = true;
    };
    img.src = emojiAtlasUrl;
  }

  draw(
    cameraMatrix: Float32Array,
    settings: RenderSettings,
    vao: WebGLVertexArrayObject,
    fadeOwnerID: number,
  ): void {
    if (!this.emojiReady) return;

    const gl = this.gl;
    const ns = settings.name;
    gl.useProgram(this.program);

    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform1f(this.uTime, performance.now() / 1000);
    gl.uniform1f(this.uLerpSpeed, ns.lerpSpeed);
    gl.uniform1f(this.uCullThreshold, ns.cullThreshold);
    gl.uniform1f(this.uNameScaleFactor, ns.nameScaleFactor);
    gl.uniform1f(this.uNameScaleCap, ns.nameScaleCap);
    gl.uniform1f(this.uEmojiRowOffset, ns.emojiRowOffset);
    gl.uniform1f(this.uFadeOwnerID, fadeOwnerID);
    gl.uniform1f(this.uHoverFadeAlpha, ns.hoverFadeAlpha);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.playerDataTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.flagAtlas.texture);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.emojiAtlasTex!);

    gl.bindVertexArray(vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.maxPlayers * 2);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    if (this.emojiAtlasTex) gl.deleteTexture(this.emojiAtlasTex);
  }
}
