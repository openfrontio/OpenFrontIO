#version 300 es
precision highp float;
precision highp usampler2D;

uniform usampler2D uRailroadTex;     // R8UI — rail type per tile (0=none, 1-6)
uniform usampler2D uGhostRailTex;    // R8UI — ghost rail type per tile (0=none, 1-6)
uniform usampler2D uTileTex;         // R16UI — tile state (for owner lookup)
uniform sampler2D  uPalette;         // RGBA32F — player colors
uniform usampler2D uTerrainTex;      // R8UI — terrain bytes (bit 7 = isLand)

uniform vec2 uMapSize;
uniform float uZoom;
uniform float uRailDetailZoom;
uniform float uRailAlpha;
uniform float uRailFade;             // Zoom-based fade multiplier (0..1)
uniform float uGhostOwnerID;         // Player smallID for ghost rail color

in vec2 vWorldPos;
out vec4 fragColor;

// Bridge pixel positions per rail type, from OpenFrontIO's RailroadSprites.ts.
// Tests whether 2x-pixel offset (lp) from a tile origin is a bridge pixel.
// Bridge pixel positions from game's RailroadSprites.ts, with -2 offsets
// shifted to -1 to close the gap (game's rail extends into neighbors, ours doesn't).
bool isBridgePixel(uint rt, ivec2 lp) {
  int x = lp.x, y = lp.y;
  if (rt == 1u) { // Vertical
    return (x == -1 || x == 2) && y >= -1 && y <= 1;
  } else if (rt == 2u) { // Horizontal
    return (y == -1 && x >= -1 && x <= 1)
        || (y == 2 && x >= -1 && x <= 1)
        || (y == 3 && (x == -1 || x == 1));
  } else if (rt == 3u) { // TopLeft
    return (x == -1 && (y == -1 || y == 2))
        || (x == 0 && y == 1)
        || (x == 1 && y == 0)
        || (x == 2 && y == -1);
  } else if (rt == 4u) { // TopRight
    return (x == -1 && (y == -1 || y == 0))
        || (x == 0 && y == 1)
        || (x == 1 && y == 2)
        || (x == 2 && (y == -1 || y == 2));
  } else if (rt == 5u) { // BottomLeft
    return (x == -1 && (y == -1 || y == 2))
        || (x == 0 && y == -1)
        || (x == 1 && y == 0)
        || (x == 2 && (y == 1 || y == 2));
  } else if (rt == 6u) { // BottomRight
    return (x == -1 && y >= 0 && y <= 2)
        || (x == 0 && y == -1)
        || (x == 1 && y == -1)
        || (x == 2 && (y == -1 || y == 2));
  }
  return false;
}

// Compute rail pixel coverage for a given rail type at fractional tile position.
// Returns 0.0 for miss, 1.0 for hit (detailed mode), or AA coverage (line mode).
float railCoverage(uint rt, vec2 f) {
  if (rt == 0u) return 0.0;

  if (uZoom >= uRailDetailZoom) {
    // Detailed mode: 3x3 sub-grid with cross-ties
    float T = 1.0 / 3.0;
    float T2 = 2.0 / 3.0;
    bool center = (f.x >= T && f.x < T2 && f.y >= T && f.y < T2);
    bool hit = false;
    if (rt == 1u) {
      hit = (f.x < T) || (f.x >= T2) || center;
    } else if (rt == 2u) {
      hit = (f.y < T) || (f.y >= T2) || center;
    } else if (rt == 3u) {
      hit = (f.y < T) || (f.x < T) || center;
    } else if (rt == 4u) {
      hit = (f.y < T) || (f.x >= T2) || center;
    } else if (rt == 5u) {
      hit = (f.y >= T2) || (f.x < T) || center;
    } else if (rt == 6u) {
      hit = (f.y >= T2) || (f.x >= T2) || center;
    }
    return hit ? 1.0 : 0.0;
  } else {
    // Simplified mode: fill entire tile (tiles are small at this zoom)
    return 1.0;
  }
}

void main() {
  ivec2 tc = ivec2(floor(vWorldPos));

  if (tc.x < 0 || tc.y < 0 || tc.x >= int(uMapSize.x) || tc.y >= int(uMapSize.y))
    discard;

  uint railType = texelFetch(uRailroadTex, tc, 0).r;
  uint ghostRailType = texelFetch(uGhostRailTex, tc, 0).r;
  vec2 f = fract(vWorldPos);

  // Compute coverage for real and ghost rails
  float realCov = railCoverage(railType, f);
  // Ghost only renders where there is no real rail (values 1-6 = ghost path)
  // Value 7 = highlight marker (existing rail turns green)
  float ghostCov = (ghostRailType >= 1u && ghostRailType <= 6u && railType == 0u)
    ? railCoverage(ghostRailType, f)
    : 0.0;
  bool highlighted = (ghostRailType == 7u && railType != 0u);

  bool hitRail = (realCov * uRailAlpha > 0.001);
  bool hitGhost = (ghostCov * uRailAlpha > 0.001);

  // --- Bridge: check 3x3 neighborhood for water+rail tiles ---
  bool hitBridge = false;
  ivec2 fp = ivec2(floor(vWorldPos * 2.0)); // fragment pos in game's 2x-pixel grid

  for (int dy = -1; dy <= 1 && !hitBridge; dy++) {
    for (int dx = -1; dx <= 1 && !hitBridge; dx++) {
      ivec2 ntc = tc + ivec2(dx, dy);
      if (ntc.x < 0 || ntc.y < 0 || ntc.x >= int(uMapSize.x) || ntc.y >= int(uMapSize.y))
        continue;
      uint nRail = texelFetch(uRailroadTex, ntc, 0).r;
      if (nRail == 0u) continue;
      uint nTerr = texelFetch(uTerrainTex, ntc, 0).r;
      if ((nTerr & 0x80u) != 0u) continue; // land tile, no bridge
      ivec2 lp = fp - ntc * 2;
      if (isBridgePixel(nRail, lp)) hitBridge = true;
    }
  }

  if (!hitBridge && !hitRail && !hitGhost) discard;

  // --- Color output ---
  vec3 bridgeColor = vec3(0.773, 0.271, 0.282);

  if (hitRail) {
    float railAlpha = uRailAlpha * realCov;
    uint tileRaw = texelFetch(uTileTex, tc, 0).r;
    uint owner = tileRaw & uint(OWNER_MASK);
    vec3 railColor = owner != 0u
      ? texture(uPalette, vec2((float(owner) + 0.5) / float(PALETTE_SIZE), 0.75)).rgb
      : vec3(0.75);
    // Overlapping railroad highlight — green tint
    if (highlighted) railColor = vec3(0.2, 0.85, 0.3);
    if (hitBridge) {
      fragColor = vec4(mix(bridgeColor, railColor, railAlpha), uRailFade);
    } else {
      fragColor = vec4(railColor, railAlpha * uRailFade);
    }
  } else if (hitGhost) {
    float ghostAlpha = uRailAlpha * ghostCov * 0.5;
    vec3 ghostColor = uGhostOwnerID > 0.0
      ? texture(uPalette, vec2((uGhostOwnerID + 0.5) / float(PALETTE_SIZE), 0.75)).rgb
      : vec3(0.75);
    fragColor = vec4(ghostColor, ghostAlpha * uRailFade);
  } else {
    fragColor = vec4(bridgeColor, uRailFade);
  }
}
