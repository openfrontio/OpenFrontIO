/**
 * PreviewTerritoryPass — drives the in-game TerritoryPass for the cosmetic
 * preview so skins and patterns render exactly as they do in a match.
 *
 * Owns single-player versions of the textures the in-game renderer feeds
 * TerritoryPass with (tile state, pattern meta/data, skin atlas + per-owner
 * layer/anchor tables). The palette texture is shared with the other preview
 * passes and stays owned by CosmeticPreviewRenderer.
 */

import { base64url } from "jose";
import { decodePatternData } from "../../../../core/PatternDecoder";
import { SkinAtlasArray } from "../../gl/passes/SkinAtlasArray";
import { TerritoryPass } from "../../gl/passes/TerritoryPass";
import type { RenderSettings } from "../../gl/RenderSettings";
import { getPaletteSize } from "../../gl/utils/ColorUtils";
import { createTexture2D } from "../../gl/utils/GlUtils";

/** smallID of the preview player — matches the owner PreviewMapGenerator stamps into tileState. */
export const PREVIEW_OWNER_ID = 1;

/** Row stride of the in-game pattern-data texture (bytes per owner). */
const PATTERN_ROW_BYTES = 1024;

export class PreviewTerritoryPass {
  private readonly pass: TerritoryPass;
  private readonly tileTex: WebGLTexture;
  private readonly patternMetaTex: WebGLTexture;
  private readonly patternDataTex: WebGLTexture;
  private readonly skinLayerTex: WebGLTexture;
  private readonly skinAnchorTex: WebGLTexture;
  private readonly defenseTex: WebGLTexture;
  private readonly borderTex: WebGLTexture;

  private readonly patternMeta = new Float32Array(getPaletteSize() * 4);
  private readonly patternData = new Uint8Array(
    getPaletteSize() * PATTERN_ROW_BYTES,
  );
  private readonly skinLayer = new Uint8Array(getPaletteSize());

  private skinAtlas: SkinAtlasArray;
  private skinUrl: string | undefined;
  private isDisposed = false;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    mapW: number,
    mapH: number,
    paletteTex: WebGLTexture,
    settings: RenderSettings,
    tileState: Uint16Array,
  ) {
    const palW = getPaletteSize();

    this.tileTex = createTexture2D(gl, {
      width: mapW,
      height: mapH,
      internalFormat: gl.R16UI,
      format: gl.RED_INTEGER,
      type: gl.UNSIGNED_SHORT,
      data: null,
    });
    this.patternMetaTex = createTexture2D(gl, {
      width: palW,
      height: 1,
      internalFormat: gl.RGBA32F,
      format: gl.RGBA,
      type: gl.FLOAT,
      data: this.patternMeta,
    });
    this.patternDataTex = createTexture2D(gl, {
      width: PATTERN_ROW_BYTES,
      height: palW,
      internalFormat: gl.R8UI,
      format: gl.RED_INTEGER,
      type: gl.UNSIGNED_BYTE,
      data: this.patternData,
    });
    this.skinLayerTex = createTexture2D(gl, {
      width: palW,
      height: 1,
      internalFormat: gl.R8UI,
      format: gl.RED_INTEGER,
      type: gl.UNSIGNED_BYTE,
      data: this.skinLayer,
    });
    // Anchor the skin stamp at the island center, like a spawn tile in-game.
    const anchors = new Uint16Array(palW * 2);
    anchors[PREVIEW_OWNER_ID * 2] = mapW / 2;
    anchors[PREVIEW_OWNER_ID * 2 + 1] = mapH / 2;
    this.skinAnchorTex = createTexture2D(gl, {
      width: palW,
      height: 1,
      internalFormat: gl.RG16UI,
      format: gl.RG_INTEGER,
      type: gl.UNSIGNED_SHORT,
      data: anchors,
    });
    // No defense posts or borders in the preview: 1×1 zero textures so the
    // shader's defense-darken lookup always misses.
    this.defenseTex = createTexture2D(gl, {
      width: 1,
      height: 1,
      internalFormat: gl.R8,
      format: gl.RED,
      type: gl.UNSIGNED_BYTE,
      data: new Uint8Array(1),
    });
    this.borderTex = createTexture2D(gl, {
      width: 1,
      height: 1,
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      data: new Uint8Array(4),
    });

    this.skinAtlas = new SkinAtlasArray(gl, [], () => {});
    this.pass = new TerritoryPass(
      gl,
      mapW,
      mapH,
      this.tileTex,
      paletteTex,
      this.patternMetaTex,
      this.patternDataTex,
      this.skinAtlas.texture,
      this.skinLayerTex,
      this.skinAnchorTex,
      settings,
    );
    this.pass.setDefenseCoverageTex(this.defenseTex);
    this.pass.setBorderTex(this.borderTex);
    this.pass.setLiveRef(tileState);
  }

  setTileState(tileState: Uint16Array): void {
    this.pass.setLiveRef(tileState);
  }

  /** R16UI owner texture, for passes that color by tile owner (railroads). */
  get tileTexture(): WebGLTexture {
    return this.tileTex;
  }

  /**
   * Show a PNG skin, a pattern, or neither (plain territory color). A skin
   * wins over a pattern, as in the in-game shader.
   */
  setDecoration(skinUrl?: string, patternData?: string): void {
    if (this.isDisposed) return;
    if (skinUrl) {
      this.clearPattern();
      this.loadSkin(skinUrl);
      return;
    }
    this.clearSkin();
    if (patternData) {
      this.loadPattern(patternData);
    } else {
      this.clearPattern();
    }
  }

  /** Team games tint the skin with the player color; FFA shows raw skin colors. */
  setTeamMode(isTeamMode: boolean): void {
    this.pass.setTeamMode(isTeamMode);
  }

  draw(cameraMatrix: Float32Array): void {
    this.pass.draw(cameraMatrix);
  }

  private loadSkin(url: string): void {
    if (url === this.skinUrl) return;
    this.clearSkin();
    this.skinUrl = url;
    const atlas = new SkinAtlasArray(this.gl, [url], (_url, layer) => {
      if (this.isDisposed || atlas !== this.skinAtlas) return;
      this.skinLayer[PREVIEW_OWNER_ID] = layer + 1;
      this.uploadSkinLayer();
    });
    this.skinAtlas = atlas;
    this.pass.setSkinAtlas(atlas.texture);
  }

  private clearSkin(): void {
    if (this.skinUrl === undefined) return;
    this.skinUrl = undefined;
    this.skinAtlas.dispose();
    this.skinAtlas = new SkinAtlasArray(this.gl, [], () => {});
    this.pass.setSkinAtlas(this.skinAtlas.texture);
    this.skinLayer[PREVIEW_OWNER_ID] = 0;
    this.uploadSkinLayer();
  }

  private loadPattern(patternData: string): void {
    const off = PREVIEW_OWNER_ID * 4;
    try {
      const decoded = decodePatternData(patternData, base64url.decode);
      this.patternMeta[off] = 1.0; // hasPattern
      this.patternMeta[off + 1] = decoded.width;
      this.patternMeta[off + 2] = decoded.height;
      this.patternMeta[off + 3] = decoded.scale;
      this.patternData.set(
        decoded.bytes.slice(3),
        PREVIEW_OWNER_ID * PATTERN_ROW_BYTES,
      );
    } catch (e) {
      console.warn("Failed to decode territory pattern", e);
      this.patternMeta[off] = 0.0;
    }
    this.uploadPattern();
  }

  private clearPattern(): void {
    const off = PREVIEW_OWNER_ID * 4;
    if (this.patternMeta[off] === 0.0) return;
    this.patternMeta[off] = 0.0;
    this.uploadPattern();
  }

  private uploadPattern(): void {
    const gl = this.gl;
    const palW = getPaletteSize();
    gl.bindTexture(gl.TEXTURE_2D, this.patternMetaTex);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      palW,
      1,
      gl.RGBA,
      gl.FLOAT,
      this.patternMeta,
    );
    gl.bindTexture(gl.TEXTURE_2D, this.patternDataTex);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      PATTERN_ROW_BYTES,
      palW,
      gl.RED_INTEGER,
      gl.UNSIGNED_BYTE,
      this.patternData,
    );
  }

  private uploadSkinLayer(): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.skinLayerTex);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      getPaletteSize(),
      1,
      gl.RED_INTEGER,
      gl.UNSIGNED_BYTE,
      this.skinLayer,
    );
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    const gl = this.gl;
    this.pass.dispose();
    this.skinAtlas.dispose();
    gl.deleteTexture(this.tileTex);
    gl.deleteTexture(this.patternMetaTex);
    gl.deleteTexture(this.patternDataTex);
    gl.deleteTexture(this.skinLayerTex);
    gl.deleteTexture(this.skinAnchorTex);
    gl.deleteTexture(this.defenseTex);
    gl.deleteTexture(this.borderTex);
  }
}
