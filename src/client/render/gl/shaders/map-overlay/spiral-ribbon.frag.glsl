#version 300 es
precision highp float;

// Spiral ribbon shading — a 3D vortex projected onto the map. Spin the helix
// angle with time and derive color (position around the circumference →
// palette, cross-faded) plus a depth cue (cos: segments facing the viewer
// bright, receding ones dark). Renders into a reduced-resolution buffer
// (see SpiralRibbonPass); output is premultiplied alpha so the bilinear
// upsample doesn't fringe dark at the edges.

uniform float uTime;       // seconds
uniform float uRotSpeed;   // vortex spin, radians/sec
uniform float uTrailAlpha;
uniform int uColorCount;   // 1..MAX_TRAIL_STRANDS colors
uniform vec3 uColors[8];   // palette, wrapped once around the circumference

in float vTheta;
in float vLateral;
out vec4 fragColor;

const float TAU = 6.28318530718;

// Ribbon profile: opaque within RIB_IN of the strand centerline, fading out
// by RIB_OUT (half-width in tiles).
const float RIB_IN = 0.55;
const float RIB_OUT = 1.0;
// Glow skirt: a soft halo in the strand's own color, quadratic falloff to
// GLOW_OUT tiles with GLOW_STRENGTH peak alpha — bleeds the strands into the
// map and into each other so the vortex reads blended rather than drawn.
const float GLOW_OUT = 2.4;
const float GLOW_STRENGTH = 0.45;

void main() {
  float d = abs(vLateral);
  float core = 1.0 - smoothstep(RIB_IN, RIB_OUT, d);
  float glowFall = 1.0 - smoothstep(0.0, GLOW_OUT, d);
  float glow = GLOW_STRENGTH * glowFall * glowFall;
  float cov = core + glow * (1.0 - core);
  if (cov <= 0.003) discard;

  float theta = vTheta - uTime * uRotSpeed;
  float f = fract(theta / TAU) * float(uColorCount);
  int i = int(f) % uColorCount;
  int j = (i + 1) % uColorCount;
  float depth = 0.5 + 0.5 * cos(theta);
  vec3 color = mix(uColors[i], uColors[j], fract(f)) * mix(0.55, 1.1, depth);
  float a = uTrailAlpha * cov;
  fragColor = vec4(color * a, a);
}
