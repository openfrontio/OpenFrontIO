#version 300 es
precision highp float;

uniform sampler2D uAtlas;
uniform float uDistRange;
uniform float uOutlineWidth;
uniform float uNightAmbient;
uniform vec3  uOutlineColor;
uniform float uOutlineUsePlayerColor;
uniform float uFillUsePlayerColor;

in vec2 vUV;
in vec4 vPlayerColor;   // player territory color (rgb) + alpha
in float vIsHuman;      // 1.0 = human, 0.0 = bot/nation
out vec4 fragColor;

float median(float r, float g, float b) {
  return max(min(r, g), min(max(r, g), b));
}

void main() {
  // Degenerate fragment — skip
  if (vPlayerColor.a <= 0.0) discard;

  // Stagger fill/border curves so they never share the same gray.
  // t² for border (stays dark longer, snaps white late) and √t for fill (inverse).
  // At midpoint t=0.5: border=0.25 (dark), fill=0.71 (light) — always distinct.
  float t = 1.0 - uNightAmbient;
  float borderT = t * t;
  float fillT = sqrt(t);

  // Compute fill color: player color, or cycle-aware white↔black (inverse of border)
  vec3 defaultFill = mix(uOutlineColor, vec3(0.0), fillT);
  vec3 fillColor = mix(defaultFill, vPlayerColor.rgb, uFillUsePlayerColor);

  vec3 msd = texture(uAtlas, vUV).rgb;
  float sd = median(msd.r, msd.g, msd.b);

  vec2 unitRange = uDistRange / vec2(textureSize(uAtlas, 0));
  vec2 screenTexSize = 1.0 / fwidth(vUV);
  float screenPxRange = max(0.5 * dot(unitRange, screenTexSize), 1.0);

  float screenPxDist = screenPxRange * (sd - 0.5);
  float fillAlpha = clamp(screenPxDist + 0.5, 0.0, 1.0);

  if (uOutlineWidth > 0.0) {
    // The SDF saturates at sd=0 (screenPxDist = -screenPxRange*0.5).
    // Reserve a 1px margin so saturated fragments always get alpha=0.
    float maxOutline = max(screenPxRange * 0.5 - 1.0, 0.0);
    float effectiveOutline = min(uOutlineWidth, maxOutline);

    float outlineDist = screenPxDist + effectiveOutline;
    float outlineAlpha = clamp(outlineDist + 0.5, 0.0, 1.0);

    vec3 nightOutlineColor = mix(vec3(0.0), uOutlineColor, borderT);
    vec3 borderColor = mix(nightOutlineColor, vPlayerColor.rgb, uOutlineUsePlayerColor);
    vec3 color = mix(borderColor, fillColor, fillAlpha);
    fragColor = vec4(color, vPlayerColor.a * outlineAlpha);
  } else {
    fragColor = vec4(fillColor, vPlayerColor.a * fillAlpha);
  }
}
