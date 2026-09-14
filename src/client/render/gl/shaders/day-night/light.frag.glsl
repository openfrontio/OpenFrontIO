#version 300 es
precision highp float;

in vec2 vLocalPos;
flat in vec3 vColor;
flat in float vIntensity;

uniform float uFalloffPower;

out vec4 fragColor;

void main() {
  float dist = length(vLocalPos) * 2.0; // [0, 1] from center to edge
  if (dist > 1.0) discard;

  float falloff = pow(1.0 - dist, uFalloffPower);

  float brightness = falloff * vIntensity;
  fragColor = vec4(vColor * brightness, brightness);
}
