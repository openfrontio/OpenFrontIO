/**
 * StatusIconProgram — instanced status icons above player names.
 *
 * Renders up to 8 status icons per player (crown, traitor, disconnected,
 * alliance, alliance request, target, embargo, nuke). Each instance reads
 * individual float flags from pd5/pd6 to decide whether to draw.
 *
 * Owns: shader program, uniform locations, status atlas texture.
 * The shared playerDataTex is passed in but not owned/deleted.
 */

import statusAtlasMeta from "resources/atlases/status-atlas-meta.json";
import { assetUrl } from "src/core/AssetUrls";
import type { RenderSettings } from "../../RenderSettings";
import statusFragSrc from "../../shaders/name/status-icon.frag.glsl?raw";
import statusVertSrc from "../../shaders/name/status-icon.vert.glsl?raw";
import { createProgram } from "../../utils/GlUtils";
import type { ParsedAtlas } from "./Types";

const statusAtlasUrl = assetUrl("atlases/status-atlas.png");

const MAX_STATUS_ICONS = 8;

export class StatusIconProgram {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private playerDataTex: WebGLTexture;
  private maxPlayers: number;

  private statusAtlasTex: WebGLTexture | null = null;
  private atlasReady = false;

  // Dynamic uniform locations
  private uCamera: WebGLUniformLocation;
  private uTime: WebGLUniformLocation;
  private uLerpSpeed: WebGLUniformLocation;
  private uCullThreshold: WebGLUniformLocation;
  private uNameScaleFactor: WebGLUniformLocation;
  private uNameScaleCap: WebGLUniformLocation;
  private uStatusRowOffset: WebGLUniformLocation;
  private uFadeOwnerID: WebGLUniformLocation;
  private uHoverFadeAlpha: WebGLUniformLocation;
  private uStatusOutlinePx: WebGLUniformLocation;

  constructor(
    gl: WebGL2RenderingContext,
    atlas: ParsedAtlas,
    playerDataTex: WebGLTexture,
    maxPlayers: number,
    allianceFlashWindowTicks: number,
  ) {
    this.gl = gl;
    this.playerDataTex = playerDataTex;
    this.maxPlayers = maxPlayers;

    this.program = createProgram(gl, statusVertSrc, statusFragSrc);
    gl.useProgram(this.program);

    // Texture unit bindings
    gl.uniform1i(gl.getUniformLocation(this.program, "uPlayerData"), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "uStatusAtlas"), 1);

    // Static uniforms from atlas metadata
    const sm = statusAtlasMeta as any;
    gl.uniform1f(
      gl.getUniformLocation(this.program, "uFontSize")!,
      atlas.fontSize,
    );
    gl.uniform1f(gl.getUniformLocation(this.program, "uFontBase")!, atlas.base);
    gl.uniform1f(
      gl.getUniformLocation(this.program, "uStatusCell")!,
      sm.cellSize,
    );
    gl.uniform1f(gl.getUniformLocation(this.program, "uStatusCols")!, sm.cols);
    gl.uniform1f(
      gl.getUniformLocation(this.program, "uStatusAtlasW")!,
      sm.width,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.program, "uStatusAtlasH")!,
      sm.height,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.program, "uStatusPad")!,
      sm.pad ?? 0,
    );
    // Texel size for the outline dilation sampling (static).
    gl.uniform2f(
      gl.getUniformLocation(this.program, "uStatusTexel")!,
      1 / sm.width,
      1 / sm.height,
    );
    // Flash window matches the alliance renewal prompt (10 ticks/sec)
    gl.uniform1f(
      gl.getUniformLocation(this.program, "uAllianceFlashWindowSec")!,
      allianceFlashWindowTicks / 10,
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
    this.uStatusRowOffset = gl.getUniformLocation(
      this.program,
      "uStatusRowOffset",
    )!;
    this.uFadeOwnerID = gl.getUniformLocation(this.program, "uFadeOwnerID")!;
    this.uHoverFadeAlpha = gl.getUniformLocation(
      this.program,
      "uHoverFadeAlpha",
    )!;
    this.uStatusOutlinePx = gl.getUniformLocation(
      this.program,
      "uStatusOutlinePx",
    )!;

    this.loadAtlas();
  }

  private loadAtlas(): void {
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
      this.statusAtlasTex = tex;
      this.atlasReady = true;
    };
    img.src = statusAtlasUrl;
  }

  draw(
    cameraMatrix: Float32Array,
    settings: RenderSettings,
    vao: WebGLVertexArrayObject,
    fadeOwnerID: number,
  ): void {
    if (!this.atlasReady) return;

    const gl = this.gl;
    const ns = settings.name;
    gl.useProgram(this.program);

    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform1f(this.uTime, performance.now() / 1000);
    gl.uniform1f(this.uLerpSpeed, ns.lerpSpeed);
    gl.uniform1f(this.uCullThreshold, ns.cullThreshold);
    gl.uniform1f(this.uNameScaleFactor, ns.nameScaleFactor);
    gl.uniform1f(this.uNameScaleCap, ns.nameScaleCap);
    gl.uniform1f(this.uStatusRowOffset, ns.statusRowOffset);
    gl.uniform1f(this.uFadeOwnerID, fadeOwnerID);
    gl.uniform1f(this.uHoverFadeAlpha, ns.hoverFadeAlpha);
    gl.uniform1f(this.uStatusOutlinePx, ns.statusOutlineWidth);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.playerDataTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.statusAtlasTex!);

    gl.bindVertexArray(vao);
    gl.drawArraysInstanced(
      gl.TRIANGLES,
      0,
      6,
      this.maxPlayers * MAX_STATUS_ICONS,
    );
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    if (this.statusAtlasTex) gl.deleteTexture(this.statusAtlasTex);
  }
}
