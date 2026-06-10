/**
 * Affiliation palette — maps ownerID → affiliation color for alt-view.
 *
 * TEX_W×2 RGBA8 texture (TEX_W = PALETTE_SIZE = 4096):
 *   Row 0: border colors (4-state: self/ally/neutral/embargo)
 *   Row 1: unit colors (3-state: self/ally/enemy)
 *
 * Rebuilt when localPlayerID or relationship data changes.
 */

import type { RenderSettings } from "../RenderSettings";
import { getPaletteSize } from "./ColorUtils";
import { createTexture2D } from "./GlUtils";

// Relationship constants (must match adapter.ts)
const RELATION_NEUTRAL = 0;
const RELATION_FRIENDLY = 1;
const RELATION_EMBARGO = 2;

const TEX_W = getPaletteSize(); // 4096 — covers full 12-bit smallID range
const TEX_H = 2;

export class AffiliationPalette {
  private gl: WebGL2RenderingContext;
  private tex: WebGLTexture;
  private cpuData = new Uint8Array(TEX_W * TEX_H * 4);
  private dirty = false;

  // Cached inputs for rebuilding
  private localPlayerID = 0;
  private relationData: Uint8Array | null = null;
  private relationSize = 0;

  constructor(
    gl: WebGL2RenderingContext,
    private settings: RenderSettings,
  ) {
    this.gl = gl;
    this.rebuild(); // initialize to spectator-mode defaults (gray borders, red units)
    this.tex = createTexture2D(gl, {
      width: TEX_W,
      height: TEX_H,
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      data: this.cpuData,
      filter: gl.NEAREST,
    });
    this.dirty = false; // already baked into initial upload
  }

  getTexture(): WebGLTexture {
    return this.tex;
  }

  setLocalPlayer(id: number): void {
    if (id === this.localPlayerID) return;
    this.localPlayerID = id;
    this.rebuild();
  }

  updateRelations(data: Uint8Array, size: number): void {
    this.relationData = data;
    this.relationSize = size;
    this.rebuild();
  }

  /** Flush to GPU if dirty (call before drawing alt-view passes). */
  flush(): void {
    if (!this.dirty) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      TEX_W,
      TEX_H,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this.cpuData,
    );
    this.dirty = false;
  }

  private rebuild(): void {
    const d = this.cpuData;
    const lp = this.localPlayerID;
    const rel = this.relationData;
    const rs = this.relationSize;

    // Affiliation RGB values (0–1) from render-settings, expanded to 0–255.
    const a = this.settings.affiliation;
    const to255 = (v: number) => Math.round(v * 255);
    const SELF_R = to255(a.selfR),
      SELF_G = to255(a.selfG),
      SELF_B = to255(a.selfB);
    const ALLY_R = to255(a.allyR),
      ALLY_G = to255(a.allyG),
      ALLY_B = to255(a.allyB);
    const NEUTRAL_R = to255(a.neutralR),
      NEUTRAL_G = to255(a.neutralG),
      NEUTRAL_B = to255(a.neutralB);
    const ENEMY_R = to255(a.enemyR),
      ENEMY_G = to255(a.enemyG),
      ENEMY_B = to255(a.enemyB);

    for (let owner = 0; owner < TEX_W; owner++) {
      // Determine relationship
      let relation = RELATION_NEUTRAL;
      if (rel && lp > 0 && owner > 0 && owner < rs && lp < rs) {
        relation = rel[lp * rs + owner];
      }
      const isSelf = owner > 0 && owner === lp;

      // Row 0: border colors (4-state)
      const bOff = owner * 4;
      if (owner === 0) {
        d[bOff] = 0;
        d[bOff + 1] = 0;
        d[bOff + 2] = 0;
        d[bOff + 3] = 0;
      } else if (isSelf) {
        d[bOff] = SELF_R;
        d[bOff + 1] = SELF_G;
        d[bOff + 2] = SELF_B;
        d[bOff + 3] = 255;
      } else if (relation === RELATION_FRIENDLY) {
        d[bOff] = ALLY_R;
        d[bOff + 1] = ALLY_G;
        d[bOff + 2] = ALLY_B;
        d[bOff + 3] = 255;
      } else if (relation === RELATION_EMBARGO) {
        d[bOff] = ENEMY_R;
        d[bOff + 1] = ENEMY_G;
        d[bOff + 2] = ENEMY_B;
        d[bOff + 3] = 255;
      } else {
        d[bOff] = NEUTRAL_R;
        d[bOff + 1] = NEUTRAL_G;
        d[bOff + 2] = NEUTRAL_B;
        d[bOff + 3] = 255;
      }

      // Row 1: unit colors (3-state — no neutral, neutral→enemy)
      const uOff = (TEX_W + owner) * 4;
      if (owner === 0) {
        d[uOff] = 0;
        d[uOff + 1] = 0;
        d[uOff + 2] = 0;
        d[uOff + 3] = 0;
      } else if (isSelf) {
        d[uOff] = SELF_R;
        d[uOff + 1] = SELF_G;
        d[uOff + 2] = SELF_B;
        d[uOff + 3] = 255;
      } else if (relation === RELATION_FRIENDLY) {
        d[uOff] = ALLY_R;
        d[uOff + 1] = ALLY_G;
        d[uOff + 2] = ALLY_B;
        d[uOff + 3] = 255;
      } else {
        d[uOff] = ENEMY_R;
        d[uOff + 1] = ENEMY_G;
        d[uOff + 2] = ENEMY_B;
        d[uOff + 3] = 255;
      }
    }

    this.dirty = true;
  }

  dispose(): void {
    this.gl.deleteTexture(this.tex);
  }
}
