#version 300 es
precision highp float;
precision highp usampler2D;

// Spiral nuke-trail pass — renders ONLY the spiral vortex ribbons, into a
// reduced-resolution offscreen buffer (see TrailPass). The buffer is
// bilinearly upsampled and composited over the plain trails, which both cuts
// the per-fragment gather cost by the resolution factor squared and gives
// the strands their soft, glowy look. Output is premultiplied alpha so the
// upsample doesn't fringe dark at the edges.

uniform usampler2D uTrailTex;     // R32UI — trail texel: owner smallID (bits 0-11)
                                  //   + nuke bit (bit 12) + spiral phase bucket
                                  //   (bits 13-20, quantized helix angle in
                                  //   256 steps); 0 = no trail
uniform sampler2D  uEffect;       // RGBA32F — trail effect palette; this pass
                                  //   reads the nukeTrail block (rows
                                  //   MAX_TRAIL_COLORS..2*MAX_TRAIL_COLORS-1)
uniform vec2 uMapSize;
uniform float uTrailAlpha;
uniform float uTime;              // seconds — spins the vortex
uniform vec4 uSpiralBounds;       // [minX, minY, maxX, maxY] tile bounds of the
                                  //   currently-stamped spiral tiles (empty when
                                  //   minX > maxX) — the gather only runs inside

in vec2 vWorldPos;
out vec4 fragColor;

const float TAU = 6.28318530718;

// Gather falloff for spiral texels: a stamp contributes to the local strand
// reconstruction with full weight within DISC_IN of its tile center, fading
// out by DISC_OUT (reaching the whole 7×7 neighborhood — wide enough that
// the glow skirt below never hits the window edge at visible alpha).
const float DISC_IN = 0.35;
const float DISC_OUT = 2.8;
// Ribbon profile: opaque within RIB_IN of the reconstructed strand
// centerline, fading out by RIB_OUT (half-width in tiles).
const float RIB_IN = 0.55;
const float RIB_OUT = 1.0;
// Glow skirt: a soft halo in the strand's own color around the core ribbon,
// with a quadratic falloff to GLOW_OUT tiles from the centerline and
// GLOW_STRENGTH peak alpha — bleeds the strands into the map and into each
// other so the vortex reads blended rather than drawn.
const float GLOW_OUT = 2.4;
const float GLOW_STRENGTH = 0.45;
// How far outside uSpiralBounds a fragment can still be affected: glow reach
// plus centroid/rounding slack.
const float SPIRAL_BOUNDS_MARGIN = 4.0;

// ── Smooth spiral reconstruction ────────────────────────────────────────────
// Spiral strands stamped at tile resolution alias badly as hard texels —
// both the edges and the ±half-tile jitter of the rounded stamp centers.
// Reconstruct the strand locally instead: gather the 7×7 neighborhood's
// spiral texels, estimate a sub-tile strand centerline as their weighted
// centroid (weights = proximity × angular affinity to the dominant texel,
// so a crossing strand's stamps don't pull the estimate), and shade by
// distance to that centerline. Averaging several stamps cancels the
// rounding jitter, and blending the helix angle as a weighted vector
// average replaces the phase-bucket steps with continuous gradients.
// Returns true when the fragment lies on the ribbon or its glow.
bool spiralPass(ivec2 tc, ivec2 msz, out vec4 result) {
  result = vec4(0.0);
  vec2 cs[49];
  float ws[49];
  float ths[49];
  int n = 0;
  float wmax = 0.0;
  float thDom = 0.0;
  int spiralOwner = 0;
  // Most gathered texels share one owner — memoize its spiral check so the
  // effect-texture fetches don't scale with the window.
  int checkedOwner = -1;
  bool checkedOk = false;
  for (int dy = -3; dy <= 3; dy++) {
    for (int dx = -3; dx <= 3; dx++) {
      ivec2 t = tc + ivec2(dx, dy);
      if (t.x < 0 || t.y < 0 || t.x >= msz.x || t.y >= msz.y) continue;
      uint v = texelFetch(uTrailTex, t, 0).r;
      // Spiral tiles are nuke trails whose owner's nukeTrail style is spiral
      // (styleId 2 in the nuke block) with a usable palette.
      if (v == 0u || ((v >> 12) & 1u) == 0u) continue;
      int o2 = int(v & 0xFFFu);
      if (o2 != checkedOwner) {
        checkedOwner = o2;
        checkedOk =
          int(texelFetch(uEffect, ivec2(o2, MAX_TRAIL_COLORS), 0).a + 0.5) > 0 &&
          int(texelFetch(uEffect, ivec2(o2, MAX_TRAIL_COLORS + 1), 0).a + 0.5) == 2;
      }
      if (!checkedOk) continue;
      vec2 c = vec2(t) + 0.5;
      float w = 1.0 - smoothstep(DISC_IN, DISC_OUT, distance(vWorldPos, c));
      if (w <= 0.0) continue;
      float th = (float((v >> 13) & 255u) + 0.5) * (TAU / 256.0);
      cs[n] = c;
      ws[n] = w;
      ths[n] = th;
      n++;
      if (w > wmax) {
        wmax = w;
        thDom = th;
        spiralOwner = o2;
      }
    }
  }
  if (n == 0) return false;

  float wsum = 0.0;
  vec2 cen = vec2(0.0);
  vec2 dir = vec2(0.0);
  for (int k = 0; k < n; k++) {
    float aff = 0.5 + 0.5 * cos(ths[k] - thDom);
    float w = ws[k] * aff * aff;
    wsum += w;
    cen += w * cs[k];
    dir += w * vec2(cos(ths[k]), sin(ths[k]));
  }
  cen /= wsum;
  float d = distance(vWorldPos, cen);
  float core = 1.0 - smoothstep(RIB_IN, RIB_OUT, d);
  float glowFall = 1.0 - smoothstep(0.0, GLOW_OUT, d);
  float glow = GLOW_STRENGTH * glowFall * glowFall;
  float cov = core + glow * (1.0 - core);
  if (cov <= 0.003) return false;

  // A 3D vortex projected onto the map: spin the blended helix angle with
  // time and derive color (position around the circumference → palette,
  // cross-faded) plus a depth cue (cos: segments facing the viewer bright,
  // receding ones dark). rotationSpeed = radians/s.
  if (dot(dir, dir) < 1e-6) dir = vec2(cos(thDom), sin(thDom));
  int rowBase = MAX_TRAIL_COLORS;
  int count = int(texelFetch(uEffect, ivec2(spiralOwner, rowBase), 0).a + 0.5);
  float rotationSpeed =
    texelFetch(uEffect, ivec2(spiralOwner, rowBase + 2), 0).a;
  float theta = atan(dir.y, dir.x) - uTime * rotationSpeed;
  float f = fract(theta / TAU) * float(count);
  int i = int(f) % count;
  int j = (i + 1) % count;
  vec3 a = texelFetch(uEffect, ivec2(spiralOwner, rowBase + i), 0).rgb;
  vec3 b = texelFetch(uEffect, ivec2(spiralOwner, rowBase + j), 0).rgb;
  float depth = 0.5 + 0.5 * cos(theta);
  vec3 color = mix(a, b, fract(f)) * mix(0.55, 1.1, depth);
  result = vec4(color, uTrailAlpha * cov);
  return true;
}

void main() {
  ivec2 tc = ivec2(floor(vWorldPos));
  ivec2 msz = ivec2(uMapSize);
  if (tc.x < 0 || tc.y < 0 || tc.x >= msz.x || tc.y >= msz.y)
    discard;
  if (uSpiralBounds.x > uSpiralBounds.z ||
      vWorldPos.x < uSpiralBounds.x - SPIRAL_BOUNDS_MARGIN ||
      vWorldPos.y < uSpiralBounds.y - SPIRAL_BOUNDS_MARGIN ||
      vWorldPos.x > uSpiralBounds.z + SPIRAL_BOUNDS_MARGIN ||
      vWorldPos.y > uSpiralBounds.w + SPIRAL_BOUNDS_MARGIN)
    discard;

  vec4 result;
  if (!spiralPass(tc, msz, result)) discard;
  // Premultiplied — the composite blends with (ONE, ONE_MINUS_SRC_ALPHA).
  fragColor = vec4(result.rgb * result.a, result.a);
}
