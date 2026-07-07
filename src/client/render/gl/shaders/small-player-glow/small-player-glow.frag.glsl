#version 300 es
precision highp float;
precision highp usampler2D;

// Radiating glow around tiles owned by "small" players (the highlight set).
// For each fragment we find the nearest highlighted-owner tile within a radius
// and fall off smoothly, so scattered fragments each radiate their own halo and
// merge into a clean glow. Runs only when the highlight set is non-empty.

uniform usampler2D uTileTex;      // R16UI — tile state (owner in low bits)
uniform usampler2D uHighlightSet; // R8UI, 1px per owner — 1 = highlighted
uniform vec2 uMapSize;
uniform int uRadius;              // glow radius in tiles (<= MAX_R)
uniform vec3 uGlowColor;
uniform float uGlowAlpha;         // peak opacity
uniform float uPulse;             // 0..1, animated breath

in vec2 vWorldPos;
out vec4 fragColor;

// Constant loop bound (GLSL ES 3.00 wants a constant bound + dynamic break,
// mirroring border-compute.frag.glsl). uRadius clamps the effective radius.
const int MAX_R = 10;

bool highlighted(ivec2 c) {
  if (c.x < 0 || c.y < 0 || c.x >= int(uMapSize.x) || c.y >= int(uMapSize.y))
    return false;
  uint owner = texelFetch(uTileTex, c, 0).r & uint(OWNER_MASK);
  if (owner == 0u) return false;
  return texelFetch(uHighlightSet, ivec2(int(owner), 0), 0).r > 0u;
}

void main() {
  ivec2 tc = ivec2(floor(vWorldPos));
  float R = float(uRadius);
  // Breathing aura: the reach grows and shrinks, and the alpha fades fully to
  // 0 at the trough so the glow visibly pulses in and out.
  float reach = R * (0.4 + 0.6 * uPulse);
  float best = 1e9;

  for (int dy = -MAX_R; dy <= MAX_R; dy++) {
    if (dy < -uRadius || dy > uRadius) continue;
    for (int dx = -MAX_R; dx <= MAX_R; dx++) {
      if (dx < -uRadius || dx > uRadius) continue;
      if (highlighted(tc + ivec2(dx, dy))) {
        best = min(best, length(vec2(float(dx), float(dy))));
      }
    }
  }

  if (best > reach) discard;
  // 1.0 at a highlighted tile, easing to 0 at the current reach.
  float glow = 1.0 - smoothstep(0.0, reach, best);
  float a = uGlowAlpha * glow * uPulse;
  if (a <= 0.001) discard;
  fragColor = vec4(uGlowColor, a);
}
