#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;
layout(location = 1) in vec3 aInstData; // x, y, alpha

uniform mat3 uCamera;
uniform float uTilesPerPx;

out vec2  vLocalPos;
flat out float vAlpha;

// Upstream outer ring = 16 screen-px; quad needs headroom for SDF AA.
const float RING_SCREEN_PX = 20.0;

void main() {
  vec2 center = vec2(aInstData.x + 0.5, aInstData.y + 0.5);
  vAlpha = aInstData.z;

  float worldRadius = RING_SCREEN_PX * uTilesPerPx;
  vec2 worldPos = center + (aPos - 0.5) * worldRadius * 2.0;

  vec3 clip = uCamera * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);

  vLocalPos = (aPos - 0.5) * 2.0;
}
