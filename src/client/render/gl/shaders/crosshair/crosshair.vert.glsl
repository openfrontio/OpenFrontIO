#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos; // [0,1] quad

uniform mat3 uCamera;
uniform vec2 uCenter;    // world tile coords
uniform float uHalfSize; // half-size in pixels (screen space)
uniform vec2 uViewport;  // canvas width, height in pixels

out vec2 vLocal; // [-1, +1]

void main() {
  vLocal = aPos * 2.0 - 1.0;

  // Project center to clip space
  vec3 clip = uCamera * vec3(uCenter + 0.5, 1.0);

  // Offset in screen pixels → NDC
  vec2 pixelToNDC = 2.0 / uViewport;
  gl_Position = vec4(clip.xy + vLocal * uHalfSize * pixelToNDC, 0.0, 1.0);
}
