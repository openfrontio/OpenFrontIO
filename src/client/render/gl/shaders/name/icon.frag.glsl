#version 300 es
precision highp float;
precision highp sampler2DArray;

uniform sampler2DArray uFlagAtlas;
uniform sampler2D      uEmojiAtlas;

in vec2 vUV;
flat in int vIconType;  // 0 = flag, 1 = emoji, -1 = discard
flat in int vFlagLayer;
in float vHoverAlpha;

out vec4 fragColor;

void main() {
  if (vIconType < 0) discard;

  vec4 texel;
  if (vIconType == 0) {
    texel = texture(uFlagAtlas, vec3(vUV, float(vFlagLayer)));
  } else {
    texel = texture(uEmojiAtlas, vUV);
  }

  if (texel.a < 0.01) discard;
  fragColor = vec4(texel.rgb, texel.a * vHoverAlpha);
}
