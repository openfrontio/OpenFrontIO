#version 300 es
precision highp float;
precision highp usampler2D;

uniform usampler2D uTileTex;   // R16UI — tile state per cell
uniform usampler2D uRelationTex; // R8UI — relationship matrix (ownerA × ownerB)
uniform vec2 uMapSize;
uniform uint uHighlightOwner;
uniform int uHighlightThicken; // Chebyshev radius for highlight expansion

out vec4 fragColor;

uint getOwner(ivec2 c) {
  if (c.x < 0 || c.y < 0 || c.x >= int(uMapSize.x) || c.y >= int(uMapSize.y))
    return 0u;
  return texelFetch(uTileTex, c, 0).r & uint(OWNER_MASK);
}

void main() {
  ivec2 tc = ivec2(gl_FragCoord.xy);
  if (tc.x >= int(uMapSize.x) || tc.y >= int(uMapSize.y)) discard;

  uint raw = texelFetch(uTileTex, tc, 0).r;
  uint owner = raw & uint(OWNER_MASK);

  // --- Border detection ---
  float borderType = 0.0; // 0=interior, ~0.5=normal border, ~1.0=highlight border
  uint maxRel = 0u;       // 0=neutral, 1=friendly, 2=embargo

  if (owner != 0u) {
    // Cardinal neighbor check (standard border)
    uint n = getOwner(tc + ivec2( 0, -1));
    uint s = getOwner(tc + ivec2( 0,  1));
    uint w = getOwner(tc + ivec2(-1,  0));
    uint e = getOwner(tc + ivec2( 1,  0));

    bool isBorder = (n != owner) || (s != owner) || (w != owner) || (e != owner);

    if (isBorder) {
      borderType = 0.5; // normal border

      // Relationship lookup for each cardinal neighbor with different owner
      if (n != owner && n != 0u) maxRel = max(maxRel, texelFetch(uRelationTex, ivec2(owner, n), 0).r);
      if (s != owner && s != 0u) maxRel = max(maxRel, texelFetch(uRelationTex, ivec2(owner, s), 0).r);
      if (w != owner && w != 0u) maxRel = max(maxRel, texelFetch(uRelationTex, ivec2(owner, w), 0).r);
      if (e != owner && e != 0u) maxRel = max(maxRel, texelFetch(uRelationTex, ivec2(owner, e), 0).r);
    }

    // Highlight: N-tile Chebyshev expansion
    if (uHighlightOwner != 0u && owner == uHighlightOwner) {
      if (isBorder) {
        borderType = 1.0; // upgrade to highlight border
      } else {
        // Check expanding rings for any tile with different owner
        for (int d = 1; d <= 10; d++) {
          if (d > uHighlightThicken) break;
          bool found = false;
          // Check all tiles at Chebyshev distance d
          for (int i = -d; i <= d; i++) {
            // Top/bottom edges
            if (getOwner(tc + ivec2(i, -d)) != owner) { found = true; break; }
            if (getOwner(tc + ivec2(i,  d)) != owner) { found = true; break; }
          }
          if (!found) {
            for (int i = -d + 1; i <= d - 1; i++) {
              // Left/right edges (excluding corners already checked)
              if (getOwner(tc + ivec2(-d, i)) != owner) { found = true; break; }
              if (getOwner(tc + ivec2( d, i)) != owner) { found = true; break; }
            }
          }
          if (found) {
            borderType = 1.0; // highlight border
            break;
          }
        }
      }
    }
  }

  // A = relationship: 0.0=neutral, 0.5=friendly, 1.0=embargo
  float relation = float(maxRel) * 0.5;
  // G channel is unused (formerly emberIntensity; ember is now computed in
  // FalloutBloomPass and FalloutLightPass). B channel is unused (defense post
  // proximity is now computed per-tile by DefenseCoveragePass).
  fragColor = vec4(borderType, 0.0, 0.0, relation);
}
