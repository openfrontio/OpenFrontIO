#version 300 es
precision highp float;

in vec2 vUV;
flat in float vAtlasIdx;
flat in float vOpacity;

uniform sampler2D uEmojiAtlas;
uniform float uEmojiCell;
uniform float uEmojiCols;
uniform float uEmojiAtlasW;
uniform float uEmojiAtlasH;

out vec4 fragColor;

void main() {
  if (vAtlasIdx < 0.0) discard;

  float col = mod(vAtlasIdx, uEmojiCols);
  float row = floor(vAtlasIdx / uEmojiCols);

  vec2 cellOrigin = vec2(col * uEmojiCell / uEmojiAtlasW, row * uEmojiCell / uEmojiAtlasH);
  vec2 cellSize = vec2(uEmojiCell / uEmojiAtlasW, uEmojiCell / uEmojiAtlasH);

  vec4 texel = texture(uEmojiAtlas, cellOrigin + vUV * cellSize);
  fragColor = vec4(texel.rgb, texel.a * vOpacity);
}
