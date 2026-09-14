#version 300 es
precision highp float;

uniform sampler2D uAtlas;
uniform float uDistRange;

in vec2 vUV;
flat in float vAlpha;
flat in vec3 vColor;
flat in float vOutlineWidth;
out vec4 fragColor;

float median(float r, float g, float b) {
  return max(min(r, g), min(max(r, g), b));
}

void main() {
  if (vAlpha <= 0.0) discard;

  vec3 msd = texture(uAtlas, vUV).rgb;
  float sd = median(msd.r, msd.g, msd.b);

  vec2 unitRange = uDistRange / vec2(textureSize(uAtlas, 0));
  vec2 screenTexSize = 1.0 / fwidth(vUV);
  float screenPxRange = max(0.5 * dot(unitRange, screenTexSize), 1.0);

  float screenPxDist = screenPxRange * (sd - 0.5);
  float fillAlpha = clamp(screenPxDist + 0.5, 0.0, 1.0);

  // Colored text with dark outline
  float maxOutline = max(screenPxRange * 0.5 - 1.0, 0.0);
  float effectiveOutline = min(vOutlineWidth, maxOutline);
  float outlineDist = screenPxDist + effectiveOutline;
  float outlineAlpha = clamp(outlineDist + 0.5, 0.0, 1.0);

  // Soft dark halo extending past the hard outline — easier to read over
  // busy terrain. Uses whatever SDF range is left after the hard outline so
  // it can always fade fully to zero before hitting the SDF saturation
  // boundary (otherwise the glow clips at the glyph quad and looks square).
  // Quadratic falloff for a true glow shape — brightest right next to the
  // text, smoothly thinning to nothing.
  float glowExtent = max(screenPxRange * 0.5 - effectiveOutline - 0.5, 0.0);
  float glowT =
    clamp((outlineDist + glowExtent) / max(glowExtent, 0.0001), 0.0, 1.0);
  float glowAlpha = glowExtent > 0.0 ? glowT * glowT * 0.75 : 0.0;

  vec3 color = mix(vec3(0.0), vColor, fillAlpha);
  fragColor = vec4(color, max(outlineAlpha, glowAlpha) * vAlpha);
}
