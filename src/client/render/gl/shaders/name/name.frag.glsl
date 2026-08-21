#version 300 es
precision highp float;

uniform sampler2D uAtlas;
uniform float uDistRange;
uniform float uOutlineWidth;
uniform float uNightAmbient;
uniform vec3  uOutlineColor;
uniform float uOutlineUsePlayerColor;
uniform float uFillUsePlayerColor;
uniform float uHoverGlowWidth; // px the white hover glow extends past the outline
uniform float uHoverGlowAlpha; // peak opacity of the hover glow

in vec2 vUV;
in vec4 vPlayerColor;   // player territory color (rgb) + alpha
in float vNameShade;      // name fill grayscale shade (0.0 = black)
flat in float vHighlight; // 1.0 when this player is hovered (white glow)
out vec4 fragColor;

float median(float r, float g, float b) {
  return max(min(r, g), min(max(r, g), b));
}

void main() {
  // Degenerate fragment — skip
  if (vPlayerColor.a <= 0.0) discard;

  // Border darkens with night: t² stays dark longer, snaps toward the
  // outline color late in the day cycle.
  float t = 1.0 - uNightAmbient;
  float borderT = t * t;

  // Compute fill color: player color, or per-type grayscale shade
  // (black for human, grayer for nation/bot). Applies in day and night.
  vec3 defaultFill = vec3(vNameShade);
  vec3 fillColor = mix(defaultFill, vPlayerColor.rgb, uFillUsePlayerColor);

  vec3 msd = texture(uAtlas, vUV).rgb;
  float sd = median(msd.r, msd.g, msd.b);

  vec2 unitRange = uDistRange / vec2(textureSize(uAtlas, 0));
  vec2 screenTexSize = 1.0 / fwidth(vUV);
  float screenPxRange = max(0.5 * dot(unitRange, screenTexSize), 1.0);

  float screenPxDist = screenPxRange * (sd - 0.5);
  float fillAlpha = clamp(screenPxDist + 0.5, 0.0, 1.0);

  // The SDF saturates at sd=0 (screenPxDist = -screenPxRange*0.5).
  // Reserve a 1px margin so saturated fragments always get alpha=0.
  float maxOutline = max(screenPxRange * 0.5 - 1.0, 0.0);
  float effectiveOutline = min(uOutlineWidth, maxOutline);

  vec3 color;
  float coverage;
  if (uOutlineWidth > 0.0) {
    float outlineDist = screenPxDist + effectiveOutline;
    float outlineAlpha = clamp(outlineDist + 0.5, 0.0, 1.0);

    vec3 nightOutlineColor = mix(vec3(0.0), uOutlineColor, borderT);
    vec3 borderColor = mix(nightOutlineColor, vPlayerColor.rgb, uOutlineUsePlayerColor);
    color = mix(borderColor, fillColor, fillAlpha);
    coverage = outlineAlpha;
  } else {
    color = fillColor;
    coverage = fillAlpha;
  }

  // Soft white glow behind the hovered player's name. Width is clamped to
  // the SDF margin past the outline so it never hard-clips at the quad edge.
  if (vHighlight > 0.5 && uHoverGlowAlpha > 0.0) {
    float glowWidth = min(uHoverGlowWidth, max(maxOutline - effectiveOutline, 0.0));
    if (glowWidth > 0.0) {
      float g = clamp(1.0 + (screenPxDist + effectiveOutline) / glowWidth, 0.0, 1.0);
      float glowAlpha = g * g * uHoverGlowAlpha;
      float total = coverage + glowAlpha * (1.0 - coverage);
      if (total > 0.0) {
        color = mix(vec3(1.0), color, coverage / total);
        coverage = total;
      }
    }
  }

  fragColor = vec4(color, vPlayerColor.a * coverage);
}
