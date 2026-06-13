#version 300 es
precision highp float;

// round_6x6_modified bitmap atlas: white digits with a baked-in dark outline
// on a transparent background (non-premultiplied RGBA).
uniform sampler2D uAtlas;
uniform int   uHighlightMask;
uniform float uHighlightDimAlpha;

in vec2 vUV;
flat in float vAlive;
flat in float vAtlasIdx;
out vec4 fragColor;

void main() {
  if (vAlive <= 0.0) discard;

  vec4 texel = texture(uAtlas, vUV);
  if (texel.a <= 0.0) discard;

  float alpha = texel.a;

  // Dim level text for non-highlighted structure types
  if (uHighlightMask != 0) {
    int bit = 1 << int(vAtlasIdx + 0.5);
    if ((uHighlightMask & bit) == 0) {
      alpha *= uHighlightDimAlpha;
    }
  }

  fragColor = vec4(texel.rgb, alpha);
}
