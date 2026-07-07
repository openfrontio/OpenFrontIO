#version 300 es
precision highp float;
precision highp usampler2D;

// Extract pass: at sub-tile resolution, emit 1 where a "small" player owns a
// tile, else 0. Because small-player territory is sparse (often single tiles),
// each output cell scans its whole TILE_SCALE x TILE_SCALE tile block rather
// than point-sampling, so no lone tile is missed. The result is then blurred
// into the soft radiating aura. OWNER_MASK and TILE_SCALE are injected.

uniform usampler2D uTileTex;      // R16UI — tile state (owner in low bits)
uniform usampler2D uHighlightSet; // R8UI, 1px per owner — 1 = highlighted
uniform vec2 uMapSize;

out vec4 fragColor;

void main() {
  ivec2 base = ivec2(gl_FragCoord.xy) * TILE_SCALE;
  for (int j = 0; j < TILE_SCALE; j++) {
    for (int i = 0; i < TILE_SCALE; i++) {
      ivec2 tc = base + ivec2(i, j);
      if (tc.x >= int(uMapSize.x) || tc.y >= int(uMapSize.y)) continue;
      uint owner = texelFetch(uTileTex, tc, 0).r & uint(OWNER_MASK);
      if (owner != 0u &&
          texelFetch(uHighlightSet, ivec2(int(owner), 0), 0).r > 0u) {
        fragColor = vec4(1.0);
        return;
      }
    }
  }
  discard;
}
