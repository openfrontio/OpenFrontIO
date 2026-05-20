#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;        // unit quad [0,1]x[0,1]
layout(location = 1) in vec3 aInstData;   // x, y, progress

uniform mat3 uCamera;
uniform vec2 uBarSize;     // (width, height) in world tiles
uniform vec2 uBarOffset;   // offset from unit center in tiles

out vec2 vLocalPos;        // [0, barWidth] x [0, barHeight]
flat out float vProgress;

void main() {
  float worldX = aInstData.x;
  float worldY = aInstData.y;
  vProgress = aInstData.z;

  vec2 center = vec2(worldX + 0.5, worldY + 0.5);
  vec2 barOrigin = center + uBarOffset;
  vec2 worldPos = barOrigin + aPos * uBarSize;

  vec3 clip = uCamera * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);

  vLocalPos = aPos * uBarSize;
}
