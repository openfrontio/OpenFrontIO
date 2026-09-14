#version 300 es
precision highp float;
uniform sampler2D uTex;
in vec2 vUV;
out vec4 fragColor;
void main() {
  fragColor = texture(uTex, vUV);
}
