#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;

uniform mat3 uCamera;
uniform vec2 uCenter;    // world-space tile center (integer)
uniform float uHalfSize; // box half-size in tiles

out vec2 vWorld; // world-space position

void main() {
  // Map [0,1] → [-1,+1]
  vec2 local = aPos * 2.0 - 1.0;

  // Expand quad to cover box + 1-tile padding for AA
  float r = uHalfSize + 1.0;
  vWorld = uCenter + 0.5 + local * r;

  vec3 clip = uCamera * vec3(vWorld, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
