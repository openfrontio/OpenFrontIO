#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;
layout(location = 1) in vec4 aInstData; // x, y, radius, alpha

uniform mat3 uCamera;

out vec2  vLocalPos;
flat out float vAlpha;

// Extra margin so the ring's outer feathering isn't clipped at the quad edge.
const float MARGIN = 1.1; // 10% beyond ring radius

void main() {
  vec2 center = vec2(aInstData.x + 0.5, aInstData.y + 0.5);
  float r = aInstData.z;
  vAlpha = aInstData.w;

  vec2 worldPos = center + (aPos - 0.5) * r * 2.0 * MARGIN;

  vec3 clip = uCamera * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);

  // Scale vLocalPos by the same margin so dist=1.0 stays at the ring radius
  vLocalPos = (aPos - 0.5) * 2.0 * MARGIN;
}
