#version 300 es
precision highp float;

uniform sampler2D uTerrain;

in vec2 vUV;
out vec4 fragColor;

void main() {
  fragColor = texture(uTerrain, vUV);
}
