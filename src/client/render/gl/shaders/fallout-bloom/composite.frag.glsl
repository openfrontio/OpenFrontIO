#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uBloomCoverage;
in vec2 vUV;
out vec4 fragColor;
void main() {
  vec4 bloom = texture(uTex, vUV);
  fragColor = bloom * uBloomCoverage;
}
