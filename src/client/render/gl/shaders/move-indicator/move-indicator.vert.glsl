#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;

uniform mat3 uCamera;
uniform vec2 uCenter; // world-space tile center

out vec2 vLocal; // [-1, +1] local quad space

void main() {
  vLocal = aPos * 2.0 - 1.0;

  // Quad covers ±16 tiles around center (enough for the chevrons)
  float r = 16.0;
  vec2 world = uCenter + 0.5 + vLocal * r;

  vec3 clip = uCamera * vec3(world, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
