#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;
layout(location = 1) in vec4 aInst;   // worldX, worldY, cursorX, charCode

uniform sampler2D uGlyphMetrics;  // CHAR_RANGE x 2, RGBA32F

uniform mat3  uCamera;
uniform float uZoom;

// Structure icon sizing (mirrors structure.vert.glsl)
uniform float uIconSize;
uniform float uDotsThreshold;
uniform float uScaleFactor;
uniform float uIconGrowZoom;

uniform float uFontSize;
uniform float uAtlasScaleH;
uniform float uBase;
uniform vec2  uOffset;      // badge center offset, in halfIconSize units
uniform float uTextScale;   // em height, in halfIconSize units

out vec2 vUV;
flat out float vAlive;

void main() {
  int charCode = int(aInst.w);

  float iconScale;
  if (uZoom <= uDotsThreshold) {
    iconScale = 0.0;
  } else if (uZoom >= uIconGrowZoom) {
    iconScale = uZoom / uIconGrowZoom;
  } else {
    iconScale = min(1.0, uZoom / uScaleFactor);
  }
  if (iconScale <= 0.0 || charCode == 0) {
    gl_Position = vec4(0.0);
    vUV = vec2(0.0);
    vAlive = 0.0;
    return;
  }

  vec4 m0 = texelFetch(uGlyphMetrics, ivec2(charCode, 0), 0); // xadvance, xoffset, yoffset, width
  vec4 m1 = texelFetch(uGlyphMetrics, ivec2(charCode, 1), 0); // height, u0, v0, u1
  float glyphW = m0.w;
  float glyphH = m1.x;
  if (glyphW <= 0.0 || glyphH <= 0.0) {
    gl_Position = vec4(0.0);
    vUV = vec2(0.0);
    vAlive = 0.0;
    return;
  }
  vAlive = 1.0;

  float halfIconSize = uIconSize * iconScale * 0.5 / uZoom;
  float scale = halfIconSize * uTextScale / uFontSize;
  vec2 center = vec2(aInst.x + 0.5, aInst.y + 0.5) + uOffset * halfIconSize;

  float baselineY = -uBase * 0.5;
  vec2 glyphOrigin = vec2(aInst.z + m0.y, baselineY + m0.z) * scale;
  vec2 glyphSize = vec2(glyphW, glyphH) * scale;
  vec2 worldPos = center + glyphOrigin + aPos * glyphSize;

  vec3 clip = uCamera * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);

  float u0 = m1.y, v0 = m1.z, u1 = m1.w;
  float v1 = v0 + glyphH / uAtlasScaleH;
  vUV = vec2(mix(u0, u1, aPos.x), mix(v0, v1, aPos.y));
}
