#version 300 es
precision highp float;

uniform sampler2D uAtlas;
uniform float uDistRange;
uniform float uOutlineWidth;
uniform int   uHighlightMask;
uniform float uHighlightDimAlpha;
uniform int   uClassic; // 1 = round_6x6 bitmap font, 0 = overpass MSDF

in vec2 vUV;
flat in float vAlive;
flat in float vAtlasIdx;
out vec4 fragColor;

float median(float r, float g, float b) {
  return max(min(r, g), min(max(r, g), b));
}

void main() {
  if (vAlive <= 0.0) discard;

  vec3 color;
  float alpha;

  if (uClassic == 1) {
    // round_6x6_modified bitmap: white digits with a baked-in dark outline
    // on a transparent background (non-premultiplied RGBA).
    vec4 texel = texture(uAtlas, vUV);
    if (texel.a <= 0.0) discard;
    color = texel.rgb;
    alpha = texel.a;
  } else {
    // overpass-bold MSDF: white fill with a synthesized dark outline.
    vec3 msd = texture(uAtlas, vUV).rgb;
    float sd = median(msd.r, msd.g, msd.b);

    vec2 unitRange = uDistRange / vec2(textureSize(uAtlas, 0));
    vec2 screenTexSize = 1.0 / fwidth(vUV);
    float screenPxRange = max(0.5 * dot(unitRange, screenTexSize), 1.0);

    float screenPxDist = screenPxRange * (sd - 0.5);
    float fillAlpha = clamp(screenPxDist + 0.5, 0.0, 1.0);

    float maxOutline = max(screenPxRange * 0.5 - 1.0, 0.0);
    float effectiveOutline = min(uOutlineWidth, maxOutline);
    float outlineAlpha = clamp(screenPxDist + effectiveOutline + 0.5, 0.0, 1.0);

    color = mix(vec3(0.0), vec3(1.0), fillAlpha);
    alpha = outlineAlpha;
  }

  // Dim level text for non-highlighted structure types
  if (uHighlightMask != 0) {
    int bit = 1 << int(vAtlasIdx + 0.5);
    if ((uHighlightMask & bit) == 0) {
      alpha *= uHighlightDimAlpha;
    }
  }

  fragColor = vec4(color, alpha);
}
