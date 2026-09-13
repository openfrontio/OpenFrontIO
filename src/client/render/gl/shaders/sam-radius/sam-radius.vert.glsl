#version 300 es
precision highp float;

// Unit quad [0,1]
layout(location = 0) in vec2 aPos;
// Per-instance: x, y, radius
layout(location = 1) in vec3 aInstance;
// Per-instance: r, g, b, alpha
layout(location = 2) in vec4 aColor;
// Per-instance: arcStart, arcEnd, spin
layout(location = 3) in vec3 aArcBounds;

uniform mat3 uCamera;

out vec2 vLocal;        // [-1, +1] local coords
flat out float vRadius; // world-space radius for this instance
flat out vec4 vColor;   // relationship color + instance alpha
flat out vec2 vArcBounds; // arc start/end in [0, 2PI)
flat out float vSpin;   // 1.0 = spinning, 0.0 = static

void main() {
  vLocal = aPos * 2.0 - 1.0;
  vRadius = aInstance.z;
  vColor = aColor;
  vArcBounds = aArcBounds.xy;
  vSpin = aArcBounds.z;

  // Expand quad to cover circle bbox + padding for stroke
  float r = aInstance.z + 2.0;
  vec2 center = aInstance.xy + 0.5;
  vec2 worldPos = center + vLocal * r;

  vec3 clip = uCamera * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
