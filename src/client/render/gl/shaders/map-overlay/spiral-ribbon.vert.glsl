#version 300 es
precision highp float;

// Spiral ribbon strip — one strand of a spiral nuke trail. Vertices are
// centerline samples expanded to a fixed-width strip (aSide = ±1); this
// shader swings each sample sideways along its perpendicular by the helix
// offset, so the strip follows the strand. Amplitude ramps 0 → uRadius over
// one pitch behind the head (the cone that converges into the missile) —
// evaluated here from uHeadDist so appended vertices never need rewriting.

layout(location = 0) in vec2 aCenter; // centerline sample (world tiles)
layout(location = 1) in vec2 aPerp;   // unit perpendicular of the path there
layout(location = 2) in float aDist;  // cumulative centerline distance
layout(location = 3) in float aSide;  // ±1 — which edge of the strip

uniform mat3 uCamera;
uniform float uHeadDist;  // cumulative distance at the nuke's head
uniform float uConeLen;   // cone length = one helix pitch, tiles
uniform float uRadius;    // helix amplitude, tiles
uniform float uTwist;     // helix phase advance, radians per tile
uniform float uPhase0;    // this strand's phase offset around the axis
uniform float uHalfWidth; // strip half-width, tiles (covers core + glow)

out float vTheta;   // helix angle at this point (un-spun)
out float vLateral; // signed distance from the strand centerline, tiles

const float HALF_PI = 1.57079632679;

void main() {
  float behind = clamp((uHeadDist - aDist) / uConeLen, 0.0, 1.0);
  float amp = uRadius * sin(HALF_PI * behind);
  float theta = aDist * uTwist + uPhase0;
  float off = amp * sin(theta);

  // Strand tangent = centerline direction + lateral swing rate, so the strip
  // stays perpendicular to the strand even on steep swings and in the cone.
  // d(amp)/d(dist) via behind' = -1/uConeLen inside the cone, 0 past it.
  float ampDeriv = behind < 1.0
      ? -uRadius * HALF_PI * cos(HALF_PI * behind) / uConeLen
      : 0.0;
  float offDeriv = ampDeriv * sin(theta) + amp * uTwist * cos(theta);
  // aPerp = (-dirY, dirX), so the centerline direction is (aPerp.y, -aPerp.x).
  vec2 dir = vec2(aPerp.y, -aPerp.x);
  vec2 tangent = dir + aPerp * offDeriv; // never zero: |dir|=1, aPerp ⊥ dir
  vec2 n = normalize(vec2(-tangent.y, tangent.x));

  vec2 world = aCenter + aPerp * off + n * (aSide * uHalfWidth);
  vec3 clip = uCamera * vec3(world, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  vTheta = theta;
  vLateral = aSide * uHalfWidth;
}
