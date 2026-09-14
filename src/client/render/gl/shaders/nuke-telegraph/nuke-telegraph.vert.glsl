#version 300 es
precision highp float;

// Unit quad [0,1]
layout(location = 0) in vec2 aPos;
// Per-instance: x, y, innerRadius, outerRadius
layout(location = 1) in vec4 aInstance;
// Per-instance: 0 = self, 1 = ally, 2 = enemy
layout(location = 2) in float aRelation;

uniform mat3 uCamera;

out vec2 vLocal;              // [-1, +1] local coords
flat out float vInnerRadius;
flat out float vOuterRadius;
flat out float vRelation;

void main() {
  vLocal = aPos * 2.0 - 1.0;
  vInnerRadius = aInstance.z;
  vOuterRadius = aInstance.w;
  vRelation = aRelation;

  // Expand quad to cover outer circle bbox + padding
  float r = aInstance.w + 2.0;
  vec2 center = aInstance.xy + 0.5;
  vec2 worldPos = center + vLocal * r;

  vec3 clip = uCamera * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
