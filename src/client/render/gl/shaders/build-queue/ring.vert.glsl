#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;        // unit quad [0,1]²
layout(location = 1) in vec3 aInst;       // worldX, worldY, progress

uniform mat3  uCamera;
uniform float uZoom;

// Structure icon sizing (mirrors structure.vert.glsl)
uniform float uIconSize;
uniform float uDotsThreshold;
uniform float uScaleFactor;
uniform float uIconGrowZoom;

uniform vec2  uOffset;   // badge center offset from icon center, in halfIconSize units
uniform float uRadius;   // badge radius, in halfIconSize units

out vec2 vLocal;          // [-1,1]² across the badge quad
flat out float vProgress;

void main() {
  float iconScale;
  if (uZoom <= uDotsThreshold) {
    iconScale = 0.0;
  } else if (uZoom >= uIconGrowZoom) {
    iconScale = uZoom / uIconGrowZoom;
  } else {
    iconScale = min(1.0, uZoom / uScaleFactor);
  }
  if (iconScale <= 0.0) {
    gl_Position = vec4(0.0);
    vLocal = vec2(0.0);
    vProgress = 0.0;
    return;
  }

  float halfIconSize = uIconSize * iconScale * 0.5 / uZoom;
  vec2 center = vec2(aInst.x + 0.5, aInst.y + 0.5) + uOffset * halfIconSize;
  float r = uRadius * halfIconSize;

  vLocal = aPos * 2.0 - 1.0;
  vProgress = aInst.z;
  vec2 worldPos = center + vLocal * r;

  vec3 clip = uCamera * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
