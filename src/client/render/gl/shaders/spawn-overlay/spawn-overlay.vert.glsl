#version 300 es
precision highp float;

// Unit quad [0,1]
layout(location = 0) in vec2 aPos;
// Per-instance: centerX, centerY, quadRadius, kind
//   kind: 0 = enemy tile highlight, 1 = self ring, 2 = teammate ring
layout(location = 1) in vec4 aInstance;
// Per-instance: r, g, b (base color)
layout(location = 2) in vec3 aColor;

uniform mat3 uCamera;

out vec2 vWorldPos;     // tile-space position of this fragment
flat out vec2 vCenter;  // spawn center (tile coords)
flat out float vKind;
flat out vec3 vColor;

void main() {
  vec2 local = aPos * 2.0 - 1.0; // [-1, +1]
  vec2 center = aInstance.xy;
  float r = aInstance.z;
  vKind = aInstance.w;
  vColor = aColor;
  vCenter = center;

  vec2 worldPos = center + local * r;
  vWorldPos = worldPos;

  vec3 clip = uCamera * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
