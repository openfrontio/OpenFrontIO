#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;

// Per-instance: worldX, worldY, cursorX, charCode
layout(location = 1) in vec4 aInst;
// Per-instance: alpha, colorR, colorG, colorB
layout(location = 2) in vec4 aStyle;
// Per-instance: scale, outlineWidth
layout(location = 3) in vec2 aScaleOutline;

uniform sampler2D uGlyphMetrics;  // CHAR_RANGE x 2, RGBA32F

uniform mat3  uCamera;
uniform float uFontSize;
uniform float uAtlasScaleH;
uniform float uBase;
uniform float uZoom;
uniform float uMinScreenScale;  // minimum world-scale factor when zoomed out

out vec2 vUV;
flat out float vAlpha;
flat out vec3 vColor;
flat out float vOutlineWidth;

void main() {
  float worldX  = aInst.x;
  float worldY  = aInst.y;
  float cursorX = aInst.z;
  int charCode  = int(aInst.w);

  if (charCode == 0 || aStyle.x <= 0.0) {
    gl_Position = vec4(0.0);
    vUV = vec2(0.0);
    vAlpha = 0.0;
    vColor = vec3(1.0);
    vOutlineWidth = 0.0;
    return;
  }

  // Per-instance scale (world units per font em).
  // Zoom-aware minimum: ensure popups don't shrink below minScreenScale when
  // zoomed out.  effectiveScale = max(scale, minScreenScale / zoom) so that
  // at low zoom the popup grows in world-space to maintain a minimum screen
  // footprint.
  float effectiveScale = max(aScaleOutline.x, uMinScreenScale / uZoom);
  float worldScale = effectiveScale / uFontSize;

  // Glyph metrics from data texture
  vec4 m0 = texelFetch(uGlyphMetrics, ivec2(charCode, 0), 0);
  vec4 m1 = texelFetch(uGlyphMetrics, ivec2(charCode, 1), 0);

  float glyphW = m0.w;
  float glyphH = m1.x;
  float u0 = m1.y;
  float v0 = m1.z;
  float u1 = m1.w;
  float v1 = v0 + glyphH / uAtlasScaleH;

  if (glyphW <= 0.0 || glyphH <= 0.0) {
    gl_Position = vec4(0.0);
    vUV = vec2(0.0);
    vAlpha = 0.0;
    vColor = vec3(1.0);
    vOutlineWidth = 0.0;
    return;
  }

  vec2 center = vec2(worldX + 0.5, worldY + 0.5);
  float baselineY = -uBase * 0.5;

  vec2 glyphOrigin = vec2(
    cursorX + m0.y,
    baselineY + m0.z
  ) * worldScale;

  vec2 glyphSize = vec2(glyphW, glyphH) * worldScale;

  vec2 worldPos = center + glyphOrigin + aPos * glyphSize;

  vec3 clip = uCamera * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);

  vUV = vec2(mix(u0, u1, aPos.x), mix(v0, v1, aPos.y));
  vAlpha = aStyle.x;
  vColor = aStyle.yzw;
  vOutlineWidth = aScaleOutline.y;
}
