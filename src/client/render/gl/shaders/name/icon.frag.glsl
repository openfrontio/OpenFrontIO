#version 300 es
precision highp float;

uniform sampler2D uFlagAtlas;
uniform sampler2D uEmojiAtlas;

in vec2 vUV;
flat in int vIconType; // 0 = flag, 1 = emoji, -1 = discard

out vec4 fragColor;

void main() {
  if (vIconType < 0) discard;

  vec4 texel;
  if (vIconType == 0) {
    texel = texture(uFlagAtlas, vUV);
  } else {
    texel = texture(uEmojiAtlas, vUV);
  }

  if (texel.a < 0.01) discard;
  fragColor = texel;
}
