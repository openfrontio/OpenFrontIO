#version 300 es
precision highp float;

// Unit quad [0,1]
layout(location = 0) in vec2 aPos;
// Per-instance: centerX, centerY (world tile coords)
layout(location = 1) in vec2 aCenter;
// Per-instance: r, g, b
layout(location = 2) in vec3 aColor;

uniform mat3 uCamera;
uniform float uHalfSize; // half-size in screen pixels
uniform vec2 uViewport;  // canvas width, height in pixels

out vec2 vLocal; // [-1, +1]
flat out vec3 vColor;

void main() {
  vLocal = aPos * 2.0 - 1.0;
  vColor = aColor;

  // Project the center to clip space, then offset in screen pixels so the
  // marker keeps a constant on-screen size at any zoom. Nudged 1px up and
  // right so the star sits visually centered on the spawn dot.
  const vec2 NUDGE_PX = vec2(1.0, 1.0);
  vec3 clip = uCamera * vec3(aCenter + 0.5, 1.0);
  vec2 pixelToNDC = 2.0 / uViewport;
  gl_Position = vec4(
    clip.xy + (vLocal * uHalfSize + NUDGE_PX) * pixelToNDC, 0.0, 1.0);
}
