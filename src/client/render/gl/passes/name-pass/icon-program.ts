/**
 * IconProgram — instanced flag + emoji icons beside player names.
 *
 * Owns: shader program, uniform locations, flag atlas + emoji atlas textures.
 * The shared playerDataTex is passed in but not owned/deleted.
 */

import emojiAtlasMeta from "resources/atlases/emoji-atlas-meta.json";
import flagAtlasMeta from "resources/atlases/flag-atlas-meta.json";
import { assetUrl } from "src/core/AssetUrls";
import type { RenderSettings } from "../../render-settings";
import iconFragSrc from "../../shaders/name/icon.frag.glsl?raw";
import iconVertSrc from "../../shaders/name/icon.vert.glsl?raw";
import { createProgram } from "../../utils/gl-utils";
import type { ParsedAtlas } from "./types";

const emojiAtlasUrl = assetUrl("atlases/emoji-atlas.png");
const flagAtlasUrl = assetUrl("atlases/flag-atlas.png");

export class IconProgram {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private playerDataTex: WebGLTexture;
  private maxPlayers: number;

  private flagAtlasTex: WebGLTexture | null = null;
  private emojiAtlasTex: WebGLTexture | null = null;
  private iconsReady = false;

  // Dynamic uniform locations
  private uCamera: WebGLUniformLocation;
  private uTime: WebGLUniformLocation;
  private uLerpSpeed: WebGLUniformLocation;
  private uCullThreshold: WebGLUniformLocation;
  private uNameScaleFactor: WebGLUniformLocation;
  private uNameScaleCap: WebGLUniformLocation;
  private uEmojiRowOffset: WebGLUniformLocation;

  constructor(
    gl: WebGL2RenderingContext,
    atlas: ParsedAtlas,
    playerDataTex: WebGLTexture,
    maxPlayers: number,
  ) {
    this.gl = gl;
    this.playerDataTex = playerDataTex;
    this.maxPlayers = maxPlayers;

    this.program = createProgram(gl, iconVertSrc, iconFragSrc);
    gl.useProgram(this.program);

    // Texture unit bindings
    gl.uniform1i(gl.getUniformLocation(this.program, "uPlayerData"), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "uFlagAtlas"), 1);
    gl.uniform1i(gl.getUniformLocation(this.program, "uEmojiAtlas"), 2);

    // Static uniforms from atlas metadata
    const fm = flagAtlasMeta as any;
    const em = emojiAtlasMeta as any;
    gl.uniform1f(
      gl.getUniformLocation(this.program, "uFontSize")!,
      atlas.fontSize,
    );
    gl.uniform1f(gl.getUniformLocation(this.program, "uFontBase")!, atlas.base);
    gl.uniform1f(gl.getUniformLocation(this.program, "uFlagCellW")!, fm.cellW);
    gl.uniform1f(gl.getUniformLocation(this.program, "uFlagCellH")!, fm.cellH);
    gl.uniform1f(gl.getUniformLocation(this.program, "uFlagCols")!, fm.cols);
    gl.uniform1f(gl.getUniformLocation(this.program, "uFlagAtlasW")!, fm.width);
    gl.uniform1f(
      gl.getUniformLocation(this.program, "uFlagAtlasH")!,
      fm.height,
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

    this.loadAtlases();
  }

  get ready(): boolean {
    return this.iconsReady;
  }

  private loadAtlases(): void {
    const gl = this.gl;
    const load = (url: string, cb: (tex: WebGLTexture) => void) => {
      const img = new Image();
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
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          img,
        );
        gl.generateMipmap(gl.TEXTURE_2D);
        cb(tex);
      };
      img.src = url;
    };
    load(flagAtlasUrl, (tex) => {
      this.flagAtlasTex = tex;
      this.iconsReady =
        this.flagAtlasTex !== null && this.emojiAtlasTex !== null;
    });
    load(emojiAtlasUrl, (tex) => {
      this.emojiAtlasTex = tex;
      this.iconsReady =
        this.flagAtlasTex !== null && this.emojiAtlasTex !== null;
    });
  }

  draw(
    cameraMatrix: Float32Array,
    settings: RenderSettings,
    vao: WebGLVertexArrayObject,
  ): void {
    if (!this.iconsReady) return;

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

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.playerDataTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.flagAtlasTex!);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.emojiAtlasTex!);

    gl.bindVertexArray(vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.maxPlayers * 2);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    if (this.flagAtlasTex) gl.deleteTexture(this.flagAtlasTex);
    if (this.emojiAtlasTex) gl.deleteTexture(this.emojiAtlasTex);
  }
}
