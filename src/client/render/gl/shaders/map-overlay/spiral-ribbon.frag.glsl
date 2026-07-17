#version 300 es
precision highp float;

// Spiral ribbon shading — a 3D vortex projected onto the map. Spin the helix
// angle with time and derive color (position around the circumference →
// palette, cross-faded) plus a depth cue (cos: segments facing the viewer
// bright, receding ones dark).
//
// Drawn twice per strand (see SpiralRibbonPass) for a glow look — a sharp
// bright core over a soft halo:
//   uCorePass 1: the core ribbon, full resolution, straight alpha into the
//     scene; facing segments get a white-hot center (neon-tube look).
//   uCorePass 0: the halo only, into the reduced-resolution buffer
//     (premultiplied); it is bilinearly upsampled and composited
//     ADDITIVELY over the scene, so it reads as emitted light.

uniform float uTime;       // seconds
uniform float uRotSpeed;   // vortex spin, radians/sec
uniform float uTrailAlpha;
uniform int uColorCount;   // 1..MAX_TRAIL_COLORS colors
uniform vec3 uColors[8];   // palette, wrapped once around the circumference
uniform int uCorePass;     // 1 = full-res core, 0 = low-res glow halo

in float vTheta;
in float vLateral;
out vec4 fragColor;

const float TAU = 6.28318530718;

// Core ribbon profile: opaque within RIB_IN of the strand centerline,
// fading out by RIB_OUT (half-width in tiles). The smoothstep edge doubles
// as anti-aliasing at full resolution.
const float RIB_IN = 0.55;
const float RIB_OUT = 1.0;
// Halo: quadratic falloff to GLOW_OUT tiles with GLOW_STRENGTH peak alpha.
// Composited additively, so crossings and the vortex interior brighten.
const float GLOW_OUT = 3.0;
const float GLOW_STRENGTH = 0.4;
// Core brightness: alpha boost over the plain-trail alpha (a glow's core
// reads as a light source, not a translucent breadcrumb).
const float CORE_ALPHA_BOOST = 1.5;

void main() {
  float d = abs(vLateral);
  float theta = vTheta - uTime * uRotSpeed;
  float f = fract(theta / TAU) * float(uColorCount);
  int i = int(f) % uColorCount;
  int j = (i + 1) % uColorCount;
  float depth = 0.5 + 0.5 * cos(theta);
  vec3 base = mix(uColors[i], uColors[j], fract(f)) * mix(0.55, 1.1, depth);

  if (uCorePass == 1) {
    float core = 1.0 - smoothstep(RIB_IN, RIB_OUT, d);
    if (core <= 0.003) discard;
    // White-hot center, strongest on segments facing the viewer.
    float hot = (1.0 - smoothstep(0.0, RIB_IN, d)) * mix(0.15, 0.55, depth);
    vec3 color = mix(base, vec3(1.0), hot);
    float a = min(uTrailAlpha * CORE_ALPHA_BOOST, 1.0) * core;
    fragColor = vec4(color, a); // straight alpha — scene default blending
  } else {
    float glowFall = 1.0 - smoothstep(0.0, GLOW_OUT, d);
    float glow = GLOW_STRENGTH * glowFall * glowFall;
    if (glow <= 0.003) discard;
    float a = uTrailAlpha * glow;
    fragColor = vec4(base * a, a); // premultiplied — halo buffer
  }
}
