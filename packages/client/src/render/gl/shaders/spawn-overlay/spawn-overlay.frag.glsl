#version 300 es
precision highp float;
precision highp usampler2D;

uniform usampler2D uTileTex;
uniform vec2 uMapSize;

// Spawn center data packed as vec4 pairs:
//   A[i] = (x, y, r, g)
//   B[i] = (b, isSelf, isTeammate, _)
uniform vec4 uSpawnA[MAX_SPAWNS];
uniform vec4 uSpawnB[MAX_SPAWNS];
uniform int uSpawnCount;

uniform float uBreathRadius;   // normalized [0..1], animated via sin

// Configurable parameters (from render settings)
uniform float uHighlightRadiusSq; // tile highlight radius squared
uniform float uHighlightAlpha;    // tile highlight opacity
uniform vec4 uSelfRadii;          // (minR, maxR, _, _)
uniform vec4 uMateRadii;          // (minR, maxR, _, _)
uniform vec2 uGradientStops;      // (innerEdge, solidEnd)

in vec2 vWorldPos;
out vec4 fragColor;

void main() {
  ivec2 tc = ivec2(floor(vWorldPos));
  if (tc.x < 0 || tc.y < 0 || tc.x >= int(uMapSize.x) || tc.y >= int(uMapSize.y))
    discard;

  uint raw = texelFetch(uTileTex, tc, 0).r;
  uint owner = raw & uint(OWNER_MASK);
  bool unowned = (owner == 0u);

  vec4 result = vec4(0.0);

  for (int i = 0; i < MAX_SPAWNS; i++) {
    if (i >= uSpawnCount) break;

    vec2 center = uSpawnA[i].xy;
    vec3 color = vec3(uSpawnA[i].zw, uSpawnB[i].x);
    float isSelf = uSpawnB[i].y;
    float isTeammate = uSpawnB[i].z;

    float dx = vWorldPos.x - center.x;
    float dy = vWorldPos.y - center.y;
    float distSq = dx * dx + dy * dy;
    float dist = sqrt(distSq);

    // --- Tile highlights (not for self or teammates) ---
    if (isSelf < 0.5 && isTeammate < 0.5 && unowned && distSq <= uHighlightRadiusSq) {
      float a = uHighlightAlpha;
      result.rgb = mix(result.rgb, color, a * (1.0 - result.a));
      result.a = result.a + a * (1.0 - result.a);
    }

    // --- Breathing rings (self or teammate only) ---
    float minR, maxR;
    if (isSelf > 0.5) {
      minR = uSelfRadii.x;
      maxR = uSelfRadii.y;
    } else if (isTeammate > 0.5) {
      minR = uMateRadii.x;
      maxR = uMateRadii.y;
    } else {
      continue;
    }

    // Breathing ring: the gradient halo shrinks/expands in radius AND its
    // opacity pulses in phase with the breath — both driven by uBreathRadius.
    // Smooth bell shape: glow ramps up from center to the inner edge, stays
    // solid through the ring's body, then fades out past solidEnd. No hard
    // cutoffs at either side.
    float scale = 0.5 + 0.65 * uBreathRadius;  // 0.5 → 1.15 of base radius
    float bMinR = minR * scale;
    float bMaxR = maxR * scale;
    float range = bMaxR - bMinR;
    float t = (dist - bMinR) / range;
    float solidEnd = uGradientStops.y;
    float alpha = 0.0;
    if (dist < bMinR) {
      // Inner glow: transparent at the center (so your territory shows through)
      // ramping up to fully solid at the ring's inner edge.
      alpha = dist / max(bMinR, 0.001);
    } else if (t < solidEnd) {
      alpha = 1.0;
    } else if (t < 1.0) {
      alpha = 1.0 - (t - solidEnd) / (1.0 - solidEnd);
    }
    if (alpha > 0.0) {
      // Opacity pulses 65% → 100% in phase with the radius.
      alpha *= 0.65 + 0.35 * uBreathRadius;
      result.rgb = mix(result.rgb, color, alpha * (1.0 - result.a));
      result.a = result.a + alpha * (1.0 - result.a);
    }
  }

  if (result.a < 0.001) discard;
  // result is premultiplied; convert to straight for SRC_ALPHA blending
  fragColor = vec4(result.rgb / result.a, result.a);
}
