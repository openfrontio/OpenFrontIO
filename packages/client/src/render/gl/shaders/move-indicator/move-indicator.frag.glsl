#version 300 es
precision highp float;

in vec2 vLocal; // [-1, +1] over ±HALF tiles

uniform float uElapsed;      // wall-clock ms since activation
uniform vec3  uColor;        // RGB [0-1]
uniform float uPxPerTile;    // camera zoom (pixels per tile)
uniform float uStartRadius;  // screen px
uniform float uChevronSize;  // screen px
uniform float uLineWidth;    // screen px
uniform float uDuration;     // ms
uniform float uConverge;     // 0–1

out vec4 fragColor;

const float HALF = 16.0; // quad half-size in tiles (must match vertex shader)

// SDF: distance to a V-chevron pointing in +Y, centered at origin.
// The chevron has wings at (±w, -wingOff) meeting tip at (0, +tipOff).
float chevronSDF(vec2 p, float w, float tipOff, float wingOff) {
  p.x = abs(p.x);
  vec2 a = vec2(w, -wingOff);
  vec2 b = vec2(0.0, tipOff);
  vec2 ab = b - a;
  float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
  return length(p - a - ab * t);
}

void main() {
  float t = uElapsed / uDuration;
  if (t >= 1.0) discard;

  // Convert vLocal to screen pixels relative to center
  float px = vLocal.x * HALF * uPxPerTile;
  float py = vLocal.y * HALF * uPxPerTile;

  // Scale factor (matches game: grows above zoom 10)
  float sc = uPxPerTile > 10.0 ? 1.0 + (uPxPerTile - 10.0) / 10.0 : 1.0;

  float radius = uStartRadius * sc * (1.0 - t * uConverge);
  float cs = uChevronSize * sc;
  float tipOff = cs * 0.4;
  float wingOff = cs * 0.6;
  float w = cs; // wing half-width

  // 4 chevrons pointing inward
  float d = chevronSDF(vec2(px, -(py - radius)), w, tipOff, wingOff);
  d = min(d, chevronSDF(vec2(px, py + radius), w, tipOff, wingOff));
  d = min(d, chevronSDF(vec2(py, -(px - radius)), w, tipOff, wingOff));
  d = min(d, chevronSDF(vec2(py, px + radius), w, tipOff, wingOff));

  // Anti-aliased stroke (in screen pixels)
  float half_w = uLineWidth * sc * 0.5;
  float aa = 1.0;
  float mask = 1.0 - smoothstep(half_w - aa, half_w + aa, d);

  if (mask < 0.01) discard;

  float alpha = 1.0 - t;
  fragColor = vec4(uColor, alpha * mask);
}
