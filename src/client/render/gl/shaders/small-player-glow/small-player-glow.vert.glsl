#version 300 es
precision highp float;

// One map-covering quad in world (tile) space; the fragment shader does the
// per-tile glow search. Unit quad [0,1] scaled to the full map.
layout(location = 0) in vec2 aPos;

uniform mat3 uCamera;
uniform vec2 uMapSize;

out vec2 vWorldPos;

void main() {
  vec2 worldPos = aPos * uMapSize;
  vWorldPos = worldPos;
  vec3 clip = uCamera * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
