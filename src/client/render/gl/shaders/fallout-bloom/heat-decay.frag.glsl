#version 300 es
precision highp float;
precision highp usampler2D;
uniform sampler2D uHeatTex;
uniform usampler2D uTileTex;
uniform usampler2D uPrevTileTex;
uniform vec2 uMapSize;
uniform float uDecay;
out vec4 fragColor;
void main() {
  ivec2 tc = ivec2(gl_FragCoord.xy);
  if (tc.x >= int(uMapSize.x) || tc.y >= int(uMapSize.y)) discard;

  float heat = texelFetch(uHeatTex, tc, 0).r;
  uint curr = texelFetch(uTileTex, tc, 0).r;
  uint prev = texelFetch(uPrevTileTex, tc, 0).r;

  bool wasFallout = (prev & (1u << FALLOUT_BIT)) != 0u;
  bool isFallout  = (curr & (1u << FALLOUT_BIT)) != 0u;

  if (isFallout && !wasFallout) {
    heat = 1.0;
  } else if (!isFallout && wasFallout) {
    heat = 0.0;
  } else {
    heat = max(0.0, heat - uDecay / 255.0);
  }

  fragColor = vec4(heat, 0.0, 0.0, 1.0);
}
