#version 300 es
precision highp float;
precision highp usampler2D;

// Writes 1.0 into the coverage texture for every tile within `uRange` of the
// post being stamped AND owned by that post's owner. The texture is cleared to
// 0 first, so a tile no post touches stays 0. Overlapping circles from the same
// owner compose as a boolean union (1.0 over 1.0 is still 1.0 — no blending);
// circles from other owners discard at this tile and leave it untouched.

uniform usampler2D uTileTex;  // R16UI — tile state per cell
uniform vec2 uMapSize;
uniform float uRange;

flat in vec2 vPostCenter;
flat in float vOwner;

out vec4 fragColor;

void main() {
  ivec2 tc = ivec2(gl_FragCoord.xy);
  if (tc.x >= int(uMapSize.x) || tc.y >= int(uMapSize.y)) discard;

  // Circle test in tile-integer space (matches the old per-fragment loop).
  float dx = float(tc.x) - vPostCenter.x;
  float dy = float(tc.y) - vPostCenter.y;
  if (dx * dx + dy * dy > uRange * uRange) discard;

  // Same-owner test: only the tile's own owner's posts defend it.
  uint owner = texelFetch(uTileTex, tc, 0).r & uint(OWNER_MASK);
  if (owner != uint(vOwner)) discard;

  fragColor = vec4(1.0);
}
