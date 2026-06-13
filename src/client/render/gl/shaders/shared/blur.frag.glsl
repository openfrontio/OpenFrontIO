#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uDir;
in vec2 vUV;
out vec4 fragColor;
const float w[3] = float[3](0.375, 0.25, 0.0625);
void main() {
  vec4 result = texture(uTex, vUV) * w[0];
  for (int i = 1; i < 3; i++) {
    vec2 off = uDir * float(i);
    result += texture(uTex, vUV + off) * w[i];
    result += texture(uTex, vUV - off) * w[i];
  }
  fragColor = result;
}
