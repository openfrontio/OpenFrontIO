/**
 * RailroadPass — GPU railroad overlay rendering.
 *
 * Renders railroad tracks as a fullscreen quad pass, reading rail orientation
 * from an R8UI texture. Two LOD modes: detailed 3×3 sub-grid sprites at high
 * zoom, screen-space anti-aliased lines at medium zoom. Hidden below minimum
 * zoom threshold.
 *
 * Also renders ghost railroad paths (semi-transparent) for build-mode preview.
 *
 * Data flow:
 *   Uint8Array railroadState → R8UI texture (rail type per tile, 0=none, 1-6=type)
 *   GhostPreviewData         → R8UI ghost texture (ghost rail paths)
 *   R8UI terrainTex           → water detection for bridge rendering (shader neighbor lookup)
 *   R16UI tileTex (shared)   → owner lookup for rail color
 *   RGBA32F paletteTex        → player color lookup
 */

import type { GhostPreviewData } from "../../types";
import type { RenderSettings } from "../RenderSettings";
import overlayVertSrc from "../shaders/map-overlay/overlay.vert.glsl?raw";
import railroadFragSrc from "../shaders/railroad/railroad.frag.glsl?raw";
import { getPaletteSize } from "../utils/ColorUtils";
import {
  createMapQuad,
  createProgram,
  createTexture2D,
  shaderSrc,
} from "../utils/GlUtils";
import { TILE_DEFINES } from "../utils/TileCodec";

// ---------------------------------------------------------------------------
// Rail orientation (0-5) → texture value (1-6, 0=none)
// ---------------------------------------------------------------------------

const VERTICAL = 0;
const HORIZONTAL = 1;
const TOP_LEFT = 2;
const TOP_RIGHT = 3;
const BOTTOM_LEFT = 4;
const BOTTOM_RIGHT = 5;

function railExtremity(tile: number, next: number, w: number): number {
  const dx = (next % w) - (tile % w);
  const dy = (next - (next % w)) / w - (tile - (tile % w)) / w;
  if (dx === 0) return VERTICAL;
  if (dy === 0) return HORIZONTAL;
  return VERTICAL;
}

function railDirection(
  prev: number,
  cur: number,
  next: number,
  w: number,
): number {
  const x1 = prev % w,
    y1 = (prev - x1) / w;
  const x2 = cur % w,
    y2 = (cur - x2) / w;
  const x3 = next % w,
    y3 = (next - x3) / w;
  const dx1 = x2 - x1,
    dy1 = y2 - y1;
  const dx2 = x3 - x2,
    dy2 = y3 - y2;
  if (dx1 === dx2 && dy1 === dy2) {
    return dx1 !== 0 ? HORIZONTAL : VERTICAL;
  }
  if ((dx1 === 0 && dx2 !== 0) || (dx1 !== 0 && dx2 === 0)) {
    if (dx1 === 0 && dx2 === 1 && dy1 === -1) return BOTTOM_RIGHT;
    if (dx1 === 0 && dx2 === -1 && dy1 === -1) return BOTTOM_LEFT;
    if (dx1 === 0 && dx2 === 1 && dy1 === 1) return TOP_RIGHT;
    if (dx1 === 0 && dx2 === -1 && dy1 === 1) return TOP_LEFT;
    if (dx1 === 1 && dx2 === 0 && dy2 === -1) return TOP_LEFT;
    if (dx1 === -1 && dx2 === 0 && dy2 === -1) return TOP_RIGHT;
    if (dx1 === 1 && dx2 === 0 && dy2 === 1) return BOTTOM_LEFT;
    if (dx1 === -1 && dx2 === 0 && dy2 === 1) return BOTTOM_RIGHT;
  }
  return VERTICAL;
}

// ---------------------------------------------------------------------------
// RailroadPass
// ---------------------------------------------------------------------------

export class RailroadPass {
  private program: WebGLProgram;
  private railroadTex: WebGLTexture;
  private ghostRailTex: WebGLTexture;
  private tileTex: WebGLTexture;
  private paletteTex: WebGLTexture;
  private terrainTex: WebGLTexture;
  private vao: WebGLVertexArrayObject;

  private uCamera: WebGLUniformLocation;
  private uMapSize: WebGLUniformLocation;
  private uZoom: WebGLUniformLocation;
  private uRailDetailZoom: WebGLUniformLocation;
  private uRailAlpha: WebGLUniformLocation;
  private uRailFade: WebGLUniformLocation;
  private uRailThickness: WebGLUniformLocation;
  private uGhostOwnerID: WebGLUniformLocation;
  private uLocalPlayerID: WebGLUniformLocation;
  private uLocalRailColor: WebGLUniformLocation;

  private mapW: number;
  private mapH: number;
  private settings: RenderSettings;

  private cpuRailroadState: Uint8Array;
  private railroadDirty = false;

  private cpuGhostRailState: Uint8Array;
  private ghostRailDirty = false;
  private ghostOwnerID = 0;

  private localPlayerID = 0;
  private localRailColor: [number, number, number] = [0.75, 0.75, 0.75];

  constructor(
    private gl: WebGL2RenderingContext,
    mapW: number,
    mapH: number,
    tileTex: WebGLTexture,
    paletteTex: WebGLTexture,
    terrainBytes: Uint8Array,
    settings: RenderSettings,
  ) {
    this.mapW = mapW;
    this.mapH = mapH;
    this.tileTex = tileTex;
    this.paletteTex = paletteTex;
    this.settings = settings;
    this.cpuRailroadState = new Uint8Array(mapW * mapH);
    this.cpuGhostRailState = new Uint8Array(mapW * mapH);

    this.program = createProgram(
      gl,
      overlayVertSrc,
      shaderSrc(railroadFragSrc, {
        PALETTE_SIZE: getPaletteSize(),
        ...TILE_DEFINES,
      }),
    );

    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uMapSize = gl.getUniformLocation(this.program, "uMapSize")!;
    this.uZoom = gl.getUniformLocation(this.program, "uZoom")!;
    this.uRailDetailZoom = gl.getUniformLocation(
      this.program,
      "uRailDetailZoom",
    )!;
    this.uRailAlpha = gl.getUniformLocation(this.program, "uRailAlpha")!;
    this.uRailFade = gl.getUniformLocation(this.program, "uRailFade")!;
    this.uRailThickness = gl.getUniformLocation(
      this.program,
      "uRailThickness",
    )!;
    this.uGhostOwnerID = gl.getUniformLocation(this.program, "uGhostOwnerID")!;
    this.uLocalPlayerID = gl.getUniformLocation(
      this.program,
      "uLocalPlayerID",
    )!;
    this.uLocalRailColor = gl.getUniformLocation(
      this.program,
      "uLocalRailColor",
    )!;

    // Texture unit bindings + ghost defaults
    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uRailroadTex"), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "uTileTex"), 1);
    gl.uniform1i(gl.getUniformLocation(this.program, "uPalette"), 2);
    gl.uniform1i(gl.getUniformLocation(this.program, "uTerrainTex"), 3);
    gl.uniform1i(gl.getUniformLocation(this.program, "uGhostRailTex"), 4);
    gl.uniform1f(this.uGhostOwnerID, 0);

    // R8UI terrain texture (static, uploaded once for bridge detection)
    this.terrainTex = createTexture2D(gl, {
      width: mapW,
      height: mapH,
      internalFormat: gl.R8UI,
      format: gl.RED_INTEGER,
      type: gl.UNSIGNED_BYTE,
      data: terrainBytes,
      filter: gl.NEAREST,
    });

    // R8UI railroad texture
    this.railroadTex = createTexture2D(gl, {
      width: mapW,
      height: mapH,
      internalFormat: gl.R8UI,
      format: gl.RED_INTEGER,
      type: gl.UNSIGNED_BYTE,
      data: this.cpuRailroadState,
      filter: gl.NEAREST,
    });

    // R8UI ghost railroad texture (same format, ghost paths only)
    this.ghostRailTex = createTexture2D(gl, {
      width: mapW,
      height: mapH,
      internalFormat: gl.R8UI,
      format: gl.RED_INTEGER,
      type: gl.UNSIGNED_BYTE,
      data: this.cpuGhostRailState,
      filter: gl.NEAREST,
    });

    this.vao = createMapQuad(gl, mapW, mapH);
  }

  uploadRailroadState(railroadState: Uint8Array): void {
    this.cpuRailroadState.set(railroadState);
    this.railroadDirty = true;
  }

  setLocalPlayer(smallID: number): void {
    this.localPlayerID = smallID;
  }

  /** Rail color for the local player (0–1 RGB). */
  setLocalRailColor(r: number, g: number, b: number): void {
    this.localRailColor = [r, g, b];
  }

  /**
   * Sub-upload terrain bytes for tiles that changed (water-nuke conversions).
   * Keeps the R8UI water-detection texture in sync with the simulation.
   * `bytes[i]` is the new terrain byte for `refs[i]` (parallel arrays).
   */
  applyTerrainDelta(refs: readonly number[], bytes: Uint8Array): void {
    if (refs.length === 0) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.terrainTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const scratch = new Uint8Array(1);
    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i];
      const x = ref % this.mapW;
      const y = (ref - x) / this.mapW;
      scratch[0] = bytes[i];
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        x,
        y,
        1,
        1,
        gl.RED_INTEGER,
        gl.UNSIGNED_BYTE,
        scratch,
      );
    }
  }

  updateGhostPreview(data: GhostPreviewData | null): void {
    this.cpuGhostRailState.fill(0);

    if (data) {
      const maxRef = this.mapW * this.mapH;

      // Ghost rail paths (1-6 = orientation)
      for (const path of data.ghostRailPaths) {
        if (path.length === 0) continue;
        const tiles = this.computePathOrientations(path);
        for (const t of tiles) {
          if (t.ref >= 0 && t.ref < maxRef) {
            this.cpuGhostRailState[t.ref] = t.type + 1;
          }
        }
      }

      // Overlapping railroad highlights (7 = green highlight marker)
      // overlappingRailroads contains resolved tile refs (not rail IDs)
      for (const ref of data.overlappingRailroads) {
        if (ref >= 0 && ref < maxRef) {
          this.cpuGhostRailState[ref] = 7;
        }
      }

      this.ghostOwnerID = data.ownerID;
    } else {
      this.ghostOwnerID = 0;
    }

    this.ghostRailDirty = true;
  }

  /** Draw the railroad overlay. Must be called with alpha blending enabled. */
  draw(cameraMatrix: Float32Array, zoom: number): void {
    const gl = this.gl;
    const rs = this.settings.railroad;

    // Fade out as zoom drops below railMinZoom; fully invisible at railMinZoom - railFadeRange
    const fadeRange = Math.max(rs.railFadeRange, 0);
    const fadeStart = rs.railMinZoom - fadeRange;
    const fade =
      fadeRange <= 0
        ? zoom >= rs.railMinZoom
          ? 1
          : 0
        : Math.min(1, Math.max(0, (zoom - fadeStart) / fadeRange));
    if (fade <= 0) return;

    // Flush CPU railroad state → GPU
    if (this.railroadDirty) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.railroadTex);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        this.mapW,
        this.mapH,
        gl.RED_INTEGER,
        gl.UNSIGNED_BYTE,
        this.cpuRailroadState,
      );
      this.railroadDirty = false;
    }

    // Flush ghost railroad state → GPU
    if (this.ghostRailDirty) {
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, this.ghostRailTex);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        this.mapW,
        this.mapH,
        gl.RED_INTEGER,
        gl.UNSIGNED_BYTE,
        this.cpuGhostRailState,
      );
      this.ghostRailDirty = false;
    }

    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform2f(this.uMapSize, this.mapW, this.mapH);
    gl.uniform1f(this.uZoom, zoom);
    gl.uniform1f(this.uRailDetailZoom, rs.railDetailZoom);
    gl.uniform1f(this.uRailAlpha, rs.railAlpha);
    gl.uniform1f(this.uRailFade, fade);
    gl.uniform1f(this.uRailThickness, rs.railThickness);
    gl.uniform1f(this.uGhostOwnerID, this.ghostOwnerID);
    gl.uniform1f(this.uLocalPlayerID, this.localPlayerID);
    gl.uniform3f(
      this.uLocalRailColor,
      this.localRailColor[0],
      this.localRailColor[1],
      this.localRailColor[2],
    );

    // Bind textures: 0=railroad, 1=tile, 2=palette, 3=terrain, 4=ghostRail
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.railroadTex);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.tileTex);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.terrainTex);

    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.ghostRailTex);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // ---- Rail orientation computation ----

  private computePathOrientations(
    tileRefs: number[],
  ): Array<{ ref: number; type: number }> {
    if (tileRefs.length === 0) return [];
    if (tileRefs.length === 1) return [{ ref: tileRefs[0], type: VERTICAL }];
    const w = this.mapW;
    const result: Array<{ ref: number; type: number }> = [];
    result.push({
      ref: tileRefs[0],
      type: railExtremity(tileRefs[0], tileRefs[1], w),
    });
    for (let i = 1; i < tileRefs.length - 1; i++) {
      result.push({
        ref: tileRefs[i],
        type: railDirection(tileRefs[i - 1], tileRefs[i], tileRefs[i + 1], w),
      });
    }
    const last = tileRefs.length - 1;
    result.push({
      ref: tileRefs[last],
      type: railExtremity(tileRefs[last], tileRefs[last - 1], w),
    });
    return result;
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteTexture(this.railroadTex);
    gl.deleteTexture(this.ghostRailTex);
    gl.deleteTexture(this.terrainTex);
    // Don't delete tileTex or paletteTex — shared with other passes
  }
}
