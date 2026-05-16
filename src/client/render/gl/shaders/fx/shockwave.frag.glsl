#version 300 es
precision highp float;

uniform float uRingWidth;

in vec2  vLocalPos;
flat in float vAlpha;

out vec4 fragColor;

void main() {
  float dist = length(vLocalPos);
  float ringDist = abs(dist - 1.0);
  float ring = 1.0 - smoothstep(0.0, uRingWidth, ringDist);
  if (ring < 0.01) discard;
  fragColor = vec4(1.0, 1.0, 1.0, ring * vAlpha);
}
