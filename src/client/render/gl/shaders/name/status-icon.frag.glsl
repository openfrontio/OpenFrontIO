#version 300 es
precision highp float;

uniform sampler2D uStatusAtlas;

in vec2 vUV;
in vec2 vLocalUV;
flat in int vDiscard;
flat in float vAllianceFraction;
flat in vec2 vFadedUV0;
flat in vec2 vFadedUV1;
flat in float vFlashAlpha;
in float vHoverAlpha;

out vec4 fragColor;

void main() {
  if (vDiscard != 0) discard;

  vec4 texel = texture(uStatusAtlas, vUV);

  // Alliance drain: composite faded icon behind colored icon, clipped by fraction.
  // Matches the game's CSS clip-path: inset(topCut% -2px 0 -2px) behavior.
  if (vAllianceFraction > 0.0) {
    // Game formula: topCut = 20 + (1-fraction) * 80 * 0.78  (% → 0..1)
    float topCut = 0.20 + (1.0 - vAllianceFraction) * 0.624;

    // Sample faded icon at corresponding local position
    vec2 fadedUV = mix(vFadedUV0, vFadedUV1, vLocalUV);
    vec4 fadedTexel = texture(uStatusAtlas, fadedUV);

    // Above the cut line → show faded; below → show colored
    texel = vLocalUV.y < topCut ? fadedTexel : texel;
  }

  // Traitor flash: modulate alpha for urgency pulse
  texel.a *= vFlashAlpha * vHoverAlpha;

  if (texel.a < 0.01) discard;
  fragColor = texel;
}
